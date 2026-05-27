import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import {
  Book as PrismaBook,
  Loan as PrismaLoan,
  Member as PrismaMember,
  Session as PrismaSession
} from "@prisma/client";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { AddBookDto } from "./dto/add-book.dto";
import { CreateLoanDto } from "./dto/create-loan.dto";
import { LoginDto } from "./dto/login.dto";
import { ReturnLoanDto } from "./dto/return-loan.dto";
import { SignupDto } from "./dto/signup.dto";
import {
  AuthUser,
  BookCategory,
  LoanStatus,
  LoanView,
  PublicBook,
  PublicMember,
  UserRole
} from "./books.types";

const loanPeriods: Record<BookCategory, number> = {
  textbook: 3,
  general: 7,
  novel: 14
};

const categoryLabels: Record<BookCategory, string> = {
  textbook: "ตำราเรียน, หนังสือสอบ",
  general: "หนังสือทั่วไป",
  novel: "นิยาย, การ์ตูน"
};

const finePerWeekdayThb = 20;
const maxActiveLoansPerMember = 3;
const sessionTtlMs = 8 * 60 * 60 * 1000;
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };

type LoanWithRelations = PrismaLoan & {
  book: PrismaBook;
  member: PrismaMember;
};

type SessionWithMember = PrismaSession & {
  member: PrismaMember | null;
};

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async listBooks(filters: { query?: string; category?: BookCategory } = {}): Promise<PublicBook[]> {
    const query = filters.query?.trim();

    const books = await this.prisma.book.findMany({
      where: {
        ...(filters.category ? { category: filters.category } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { author: { contains: query, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ title: "asc" }]
    });

    return books.map((book) => this.toPublicBook(book));
  }

  async addBook(dto: AddBookDto): Promise<PublicBook> {
    const book = await this.prisma.book.create({
      data: {
        id: `book-${slugify(dto.title)}-${Date.now()}`,
        title: dto.title.trim(),
        author: dto.author.trim(),
        category: dto.category,
        totalCopies: dto.copies,
        availableCopies: dto.copies
      }
    });

    return this.toPublicBook(book);
  }

  async signup(dto: SignupDto): Promise<{ user: AuthUser; sessionId: string }> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.member.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException("A member with this email already exists.");
    }

    const member = await this.prisma.member.create({
      data: {
        id: `member-${Date.now()}`,
        name: dto.name.trim(),
        email,
        phone: dto.phone.trim(),
        passwordHash: hashPassword(dto.password)
      }
    });

    return this.createSession("member", member.id);
  }

  async login(dto: LoginDto): Promise<{ user: AuthUser; sessionId: string }> {
    const email = dto.email.trim().toLowerCase();

    if (dto.role === "librarian") {
      const librarianEmail = process.env.LIBRARIAN_EMAIL?.trim().toLowerCase();
      const librarianPassword = process.env.LIBRARIAN_PASSWORD;
      if (!librarianEmail || !librarianPassword) {
        throw new UnauthorizedException("Librarian login is not configured.");
      }

      if (email !== librarianEmail || dto.password !== librarianPassword) {
        throw new UnauthorizedException("Invalid librarian credentials.");
      }

      return this.createSession("librarian", null);
    }

    const member = await this.prisma.member.findUnique({ where: { email } });
    if (!member || !verifyPassword(dto.password, member.passwordHash)) {
      throw new UnauthorizedException("Invalid member credentials.");
    }

    return this.createSession("member", member.id);
  }

  async logout(sessionId: string | null): Promise<void> {
    if (sessionId) {
      await this.prisma.session.deleteMany({ where: { id: sessionId } });
    }
  }

  async getAuthUser(sessionId: string | null): Promise<AuthUser | null> {
    const session = await this.findSession(sessionId);
    if (!session) {
      return null;
    }

    return this.toAuthUser(session);
  }

  async createLoan(dto: CreateLoanDto, memberId: string): Promise<LoanView> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findUnique({ where: { id: memberId } });
      if (!member) {
        throw new NotFoundException("Member not found.");
      }

      const book = await tx.book.findUnique({ where: { id: dto.bookId } });
      if (!book) {
        throw new NotFoundException("Book not found.");
      }

      const activeLoans = await tx.loan.findMany({
        where: { memberId: member.id, returnedAt: null }
      });

      if (activeLoans.length >= maxActiveLoansPerMember) {
        throw new BadRequestException("A member can hold at most 3 active loans.");
      }

      const referenceDate = getNow();
      if (activeLoans.some((loan) => this.getLoanStatus(loan, referenceDate) === "overdue")) {
        throw new BadRequestException("A member with an overdue loan cannot borrow more.");
      }

      const updateResult = await tx.book.updateMany({
        where: {
          id: book.id,
          availableCopies: { gt: 0 }
        },
        data: {
          availableCopies: { decrement: 1 }
        }
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException("No copies are currently available for this book.");
      }

      const borrowedAt = parseInputDate(dto.borrowedAt, "loan date");
      const dueAt = addDays(borrowedAt, loanPeriods[book.category as BookCategory]);
      const created = await tx.loan.create({
        data: {
          id: `loan-${Date.now()}`,
          loanCode: generateLoanCode(),
          bookId: book.id,
          memberId: member.id,
          borrowedAt,
          dueAt,
          returnedAt: null,
          fineThb: 0
        }
      });

      const loan = await tx.loan.findUnique({
        where: { id: created.id },
        include: { book: true, member: true }
      });

      if (!loan) {
        throw new NotFoundException("Loan not found.");
      }

      return this.toLoanView(loan);
    }, transactionOptions);
  }

  async listMemberLoans(memberId: string): Promise<LoanView[]> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) {
      throw new NotFoundException("Member not found.");
    }

    const loans = await this.prisma.loan.findMany({
      where: { memberId },
      include: { book: true, member: true },
      orderBy: [{ borrowedAt: "desc" }]
    });

    return loans.map((loan) => this.toLoanView(loan));
  }

  async listLoans(filters: { member?: string; status?: LoanStatus } = {}): Promise<LoanView[]> {
    const memberQuery = filters.member?.trim();
    const loans = await this.prisma.loan.findMany({
      where: {
        ...(memberQuery
          ? {
              OR: [
                { loanCode: { contains: memberQuery, mode: "insensitive" } },
                { book: { title: { contains: memberQuery, mode: "insensitive" } } },
                { member: { name: { contains: memberQuery, mode: "insensitive" } } },
                { member: { email: { contains: memberQuery, mode: "insensitive" } } }
              ]
            }
          : {})
      },
      include: { book: true, member: true },
      orderBy: [{ borrowedAt: "desc" }]
    });

    return loans
      .map((loan) => this.toLoanView(loan))
      .filter((loan) => !filters.status || loan.status === filters.status);
  }

  async listOverdueLoans(): Promise<LoanView[]> {
    return this.listLoans({ status: "overdue" });
  }

  async returnLoan(loanId: string, dto: ReturnLoanDto = {}): Promise<LoanView> {
    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({
        where: { id: loanId },
        include: { book: true, member: true }
      });
      if (!loan) {
        throw new NotFoundException("Loan not found.");
      }

      if (loan.returnedAt) {
        throw new BadRequestException("This loan has already been returned.");
      }

      const returnedAt = parseInputDate(dto.returnedAt, "return date");
      await tx.book.update({
        where: { id: loan.bookId },
        data: {
          availableCopies: {
            increment: 1
          }
        }
      });

      const updated = await tx.loan.update({
        where: { id: loan.id },
        data: {
          returnedAt,
          fineThb: calculateFineThb(loan.borrowedAt, loan.dueAt, returnedAt)
        },
        include: { book: true, member: true }
      });

      return this.toLoanView(updated);
    }, transactionOptions);
  }

  async buildOverdueReportPdf(): Promise<Buffer> {
    const loans = await this.listOverdueLoans();
    const rows = loans.map((loan) => ({
      book: loan.book.title,
      dueDate: formatDate(loan.dueAt),
      email: loan.member.email,
      fine: `${loan.currentFineThb} THB`,
      loanCode: loan.loanCode,
      member: loan.member.name
    }));

    return buildOverdueReportPdf(rows, getNow());
  }

  getRules() {
    return {
      categories: Object.entries(loanPeriods).map(([category, periodDays]) => ({
        category,
        description: categoryLabels[category as BookCategory],
        periodDays
      })),
      finePerOverdueWeekdayThb: finePerWeekdayThb,
      maxActiveLoansPerMember
    };
  }

  private async createSession(
    role: UserRole,
    memberId: string | null
  ): Promise<{ user: AuthUser; sessionId: string }> {
    const session = await this.prisma.session.create({
      data: {
        id: randomBytes(32).toString("hex"),
        role,
        memberId,
        expiresAt: new Date(Date.now() + sessionTtlMs)
      },
      include: { member: true }
    });

    return {
      user: this.toAuthUser(session),
      sessionId: session.id
    };
  }

  private async findSession(sessionId: string | null): Promise<SessionWithMember | null> {
    if (!sessionId) {
      return null;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { member: true }
    });
    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: sessionId } });
      return null;
    }

    return session;
  }

  private toAuthUser(session: SessionWithMember): AuthUser {
    return {
      role: session.role as UserRole,
      member: session.member ? this.toPublicMember(session.member) : null
    };
  }

  private toPublicBook(book: PrismaBook): PublicBook {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category as BookCategory,
      totalCopies: book.totalCopies,
      availableCopies: book.availableCopies,
      status: book.availableCopies > 0 ? "available" : "unavailable",
      periodDays: loanPeriods[book.category as BookCategory]
    };
  }

  private toPublicMember(member: PrismaMember): PublicMember {
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone
    };
  }

  private toLoanView(loan: LoanWithRelations): LoanView {
    return {
      id: loan.id,
      loanCode: loan.loanCode,
      bookId: loan.bookId,
      memberId: loan.memberId,
      borrowedAt: loan.borrowedAt.toISOString(),
      dueAt: loan.dueAt.toISOString(),
      returnedAt: loan.returnedAt?.toISOString() ?? null,
      fineThb: loan.fineThb,
      status: this.getLoanStatus(loan, getNow()),
      currentFineThb: loan.returnedAt
        ? loan.fineThb
        : calculateFineThb(loan.borrowedAt, loan.dueAt, getNow()),
      book: this.toPublicBook(loan.book),
      member: this.toPublicMember(loan.member)
    };
  }

  private getLoanStatus(loan: Pick<PrismaLoan, "returnedAt" | "dueAt">, referenceDate: Date): LoanStatus {
    if (loan.returnedAt) {
      return "returned";
    }

    return isAfterCalendarDay(referenceDate, loan.dueAt) ? "overdue" : "active";
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getNow(): Date {
  const override = process.env.LIBRARY_TEST_NOW;
  if (!override) {
    return new Date();
  }

  const parsed = new Date(override);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseInputDate(value: string | undefined, label: string): Date {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === "now") {
    return getNow();
  }

  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T10:00:00.000Z` : normalized
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${label}. Use YYYY-MM-DD, an ISO date, or now.`);
  }

  return parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isAfterCalendarDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() > startOfDay(b).getTime();
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function calculateFineThb(borrowedAt: Date, dueAt: Date, returnedOrToday: Date): number {
  if (isSameCalendarDay(borrowedAt, returnedOrToday)) {
    return 0;
  }

  const dueDate = startOfDay(dueAt);
  const endDate = startOfDay(returnedOrToday);
  if (endDate.getTime() <= dueDate.getTime()) {
    return 0;
  }

  let overdueWeekdays = 0;
  const cursor = addDays(dueDate, 1);
  while (cursor.getTime() <= endDate.getTime()) {
    if (isWeekday(cursor)) {
      overdueWeekdays += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return overdueWeekdays * finePerWeekdayThb;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(hash, "hex");
  return storedBuffer.length === candidate.length && timingSafeEqual(storedBuffer, candidate);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "book"
  );
}

function generateLoanCode(): string {
  return `LL-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

interface OverdueReportRow {
  book: string;
  dueDate: string;
  email: string;
  fine: string;
  loanCode: string;
  member: string;
}

interface PdfPage {
  content: string[];
  pageNumber: number;
}

interface PdfColumn {
  key: keyof OverdueReportRow;
  label: string;
  width: number;
}

const pdfPageWidth = 842;
const pdfPageHeight = 595;
const pdfMargin = 36;

const overdueReportColumns: PdfColumn[] = [
  { key: "member", label: "Member", width: 125 },
  { key: "email", label: "Email", width: 175 },
  { key: "book", label: "Book", width: 165 },
  { key: "loanCode", label: "Loan Code", width: 90 },
  { key: "dueDate", label: "Due Date", width: 100 },
  { key: "fine", label: "Fine", width: 80 }
];

function buildOverdueReportPdf(rows: OverdueReportRow[], generatedAt: Date): Buffer {
  const pages: PdfPage[] = [];
  let page = createPdfPage(1, generatedAt, rows.length);
  pages.push(page);
  let y = 462;

  if (rows.length === 0) {
    drawText(page, "No overdue loans.", pdfMargin, y, 12);
  }

  rows.forEach((row, index) => {
    const wrapped = overdueReportColumns.map((column) =>
      wrapPdfText(row[column.key], column.width - 12, 9)
    );
    const rowHeight = Math.max(28, 14 + Math.max(...wrapped.map((lines) => lines.length)) * 12);

    if (y - rowHeight < 44) {
      page = createPdfPage(pages.length + 1, generatedAt, rows.length);
      pages.push(page);
      y = 462;
    }

    drawReportRow(page, row, wrapped, y, rowHeight, index % 2 === 0);
    y -= rowHeight;
  });

  pages.forEach((currentPage, index) => {
    drawText(
      currentPage,
      `Page ${index + 1} of ${pages.length}`,
      pdfPageWidth - pdfMargin - 70,
      24,
      8,
      "F1",
      "0.35 0.39 0.45"
    );
  });

  return buildPdfDocument(pages);
}

function createPdfPage(pageNumber: number, generatedAt: Date, totalRows: number): PdfPage {
  const page: PdfPage = { content: [], pageNumber };
  drawText(page, "Overdue Loans Report", pdfMargin, 548, 18, "F2", "0.08 0.09 0.11");
  drawText(
    page,
    `Generated: ${formatDate(generatedAt)}  |  Overdue loans: ${totalRows}`,
    pdfMargin,
    528,
    9,
    "F1",
    "0.35 0.39 0.45"
  );
  drawTableHeader(page, 486);
  return page;
}

function drawTableHeader(page: PdfPage, y: number): void {
  drawRect(page, pdfMargin, y, tableWidth(), 24, "0.89 0.91 0.94");
  let x = pdfMargin;
  overdueReportColumns.forEach((column) => {
    drawText(page, column.label, x + 6, y + 8, 9, "F2", "0.08 0.09 0.11");
    drawLine(page, x, y, x, y + 24, "0.72 0.76 0.82");
    x += column.width;
  });
  drawLine(page, pdfMargin + tableWidth(), y, pdfMargin + tableWidth(), y + 24, "0.72 0.76 0.82");
  drawLine(page, pdfMargin, y, pdfMargin + tableWidth(), y, "0.72 0.76 0.82");
  drawLine(page, pdfMargin, y + 24, pdfMargin + tableWidth(), y + 24, "0.72 0.76 0.82");
}

function drawReportRow(
  page: PdfPage,
  row: OverdueReportRow,
  wrapped: string[][],
  y: number,
  rowHeight: number,
  shaded: boolean
): void {
  if (shaded) {
    drawRect(page, pdfMargin, y - rowHeight, tableWidth(), rowHeight, "0.98 0.99 1");
  }

  let x = pdfMargin;
  overdueReportColumns.forEach((column, columnIndex) => {
    const lines = wrapped[columnIndex] ?? [row[column.key]];
    lines.forEach((line, lineIndex) => {
      drawText(page, line, x + 6, y - 14 - lineIndex * 12, 9);
    });
    drawLine(page, x, y - rowHeight, x, y, "0.82 0.85 0.9");
    x += column.width;
  });
  drawLine(page, pdfMargin + tableWidth(), y - rowHeight, pdfMargin + tableWidth(), y, "0.82 0.85 0.9");
  drawLine(page, pdfMargin, y - rowHeight, pdfMargin + tableWidth(), y - rowHeight, "0.82 0.85 0.9");
}

function wrapPdfText(value: string, width: number, fontSize: number): string[] {
  const maxChars = Math.max(8, Math.floor(width / (fontSize * 0.52)));
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const chunks = splitLongWord(word, maxChars);
    chunks.forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = chunk;
      } else {
        current = next;
      }
    });
  });

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function splitLongWord(word: string, maxChars: number): string[] {
  if (word.length <= maxChars) {
    return [word];
  }

  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }
  return chunks;
}

function tableWidth(): number {
  return overdueReportColumns.reduce((sum, column) => sum + column.width, 0);
}

function drawText(
  page: PdfPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font = "F1",
  color = "0.12 0.14 0.17"
): void {
  page.content.push(`BT /${font} ${size} Tf ${color} rg ${x} ${y} Td (${pdfEscape(text)}) Tj ET`);
}

function drawRect(page: PdfPage, x: number, y: number, width: number, height: number, color: string): void {
  page.content.push(`q ${color} rg ${x} ${y} ${width} ${height} re f Q`);
}

function drawLine(page: PdfPage, x1: number, y1: number, x2: number, y2: number, color: string): void {
  page.content.push(`q ${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S Q`);
}

function buildPdfDocument(pages: PdfPage[]): Buffer {
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPageWidth} ${pdfPageHeight}] /Resources << /Font << /F1 ${pages.length * 2 + 3} 0 R /F2 ${pages.length * 2 + 4} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );
    const content = page.content.join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}
