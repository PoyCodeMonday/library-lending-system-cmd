import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  NotFoundException
} from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { AddBookDto } from "./dto/add-book.dto";
import { CreateLoanDto } from "./dto/create-loan.dto";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";
import {
  AuthUser,
  Book,
  BookCategory,
  Loan,
  LoanStatus,
  LoanView,
  Member,
  PublicBook,
  PublicMember,
  Session,
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

const booksSeed: Book[] = [
  {
    id: "book-clean-code",
    title: "Clean Code",
    author: "Robert C. Martin",
    category: "textbook",
    totalCopies: 3,
    availableCopies: 2
  },
  {
    id: "book-pragmatic-programmer",
    title: "The Pragmatic Programmer",
    author: "Andrew Hunt and David Thomas",
    category: "general",
    totalCopies: 2,
    availableCopies: 1
  },
  {
    id: "book-designing-data-intensive-apps",
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    category: "textbook",
    totalCopies: 2,
    availableCopies: 0
  },
  {
    id: "book-domain-driven-design",
    title: "Domain-Driven Design",
    author: "Eric Evans",
    category: "general",
    totalCopies: 1,
    availableCopies: 1
  },
  {
    id: "book-kiki-delivery-service",
    title: "Kiki's Delivery Service",
    author: "Eiko Kadono",
    category: "novel",
    totalCopies: 2,
    availableCopies: 2
  }
];

const now = new Date();

const membersSeed: Member[] = [
  {
    id: "member-nina",
    name: "Nina Patel",
    email: "nina@example.com",
    phone: "+66812345678",
    passwordHash: hashPassword("member123"),
    createdAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "member-theo",
    name: "Theo Morgan",
    email: "theo@example.com",
    phone: "+66887654321",
    passwordHash: hashPassword("member123"),
    createdAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const loansSeed: Loan[] = [
  {
    id: "loan-existing-1",
    loanCode: "LL-1001",
    bookId: "book-designing-data-intensive-apps",
    memberId: "member-nina",
    borrowedAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    dueAt: addDays(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), 3).toISOString(),
    returnedAt: null,
    fineThb: 0
  },
  {
    id: "loan-existing-2",
    loanCode: "LL-1002",
    bookId: "book-designing-data-intensive-apps",
    memberId: "member-theo",
    borrowedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    dueAt: addDays(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), 3).toISOString(),
    returnedAt: null,
    fineThb: 0
  }
];

@Injectable()
export class BooksService {
  private readonly books = booksSeed.map((book) => ({ ...book }));
  private readonly members = membersSeed.map((member) => ({ ...member }));
  private readonly loans = loansSeed.map((loan) => ({ ...loan }));
  private readonly sessions = new Map<string, Session>();

  listBooks(filters: { query?: string; category?: BookCategory } = {}): PublicBook[] {
    const query = filters.query?.trim().toLowerCase();

    return this.books
      .map((book) => this.toPublicBook(book))
      .filter((book) => {
        if (filters.category && book.category !== filters.category) {
          return false;
        }

        if (!query) {
          return true;
        }

        return [book.title, book.author, book.category].some((value) =>
          value.toLowerCase().includes(query)
        );
      });
  }

  addBook(dto: AddBookDto): PublicBook {
    const book: Book = {
      id: `book-${slugify(dto.title)}-${Date.now()}`,
      title: dto.title.trim(),
      author: dto.author.trim(),
      category: dto.category,
      totalCopies: dto.copies,
      availableCopies: dto.copies
    };

    this.books.push(book);
    return this.toPublicBook(book);
  }

  signup(dto: SignupDto): { user: AuthUser; sessionId: string } {
    const email = dto.email.trim().toLowerCase();
    if (this.members.some((member) => member.email === email)) {
      throw new BadRequestException("A member with this email already exists.");
    }

    const member: Member = {
      id: `member-${Date.now()}`,
      name: dto.name.trim(),
      email,
      phone: dto.phone.trim(),
      passwordHash: hashPassword(dto.password),
      createdAt: new Date().toISOString()
    };

    this.members.push(member);
    return this.createSession("member", member.id);
  }

  login(dto: LoginDto): { user: AuthUser; sessionId: string } {
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

    const member = this.members.find((item) => item.email === email);
    if (!member || !verifyPassword(dto.password, member.passwordHash)) {
      throw new UnauthorizedException("Invalid member credentials.");
    }

    return this.createSession("member", member.id);
  }

  logout(sessionId: string | null): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  getAuthUser(sessionId: string | null): AuthUser | null {
    const session = this.findSession(sessionId);
    if (!session) {
      return null;
    }

    return this.toAuthUser(session);
  }

  createLoan(dto: CreateLoanDto, memberId: string): LoanView {
    const member = this.findMember(memberId);
    const book = this.findBook(dto.bookId);
    const activeLoans = this.loans.filter(
      (loan) => loan.memberId === member.id && !loan.returnedAt
    );

    if (activeLoans.length >= maxActiveLoansPerMember) {
      throw new BadRequestException("A member can hold at most 3 active loans.");
    }

    if (activeLoans.some((loan) => this.getLoanStatus(loan, new Date()) === "overdue")) {
      throw new BadRequestException("A member with an overdue loan cannot borrow more.");
    }

    if (book.availableCopies <= 0) {
      throw new BadRequestException("No copies are currently available for this book.");
    }

    book.availableCopies -= 1;

    const borrowedAt = new Date();
    const dueAt = addDays(borrowedAt, loanPeriods[book.category]);
    const loan: Loan = {
      id: `loan-${Date.now()}`,
      loanCode: `LL-${1000 + this.loans.length + 1}`,
      bookId: book.id,
      memberId: member.id,
      borrowedAt: borrowedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      returnedAt: null,
      fineThb: 0
    };

    this.loans.push(loan);
    return this.toLoanView(loan);
  }

  listMemberLoans(memberId: string): LoanView[] {
    this.findMember(memberId);
    return this.loans
      .filter((loan) => loan.memberId === memberId)
      .map((loan) => this.toLoanView(loan))
      .sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt));
  }

  listLoans(filters: { member?: string; status?: LoanStatus } = {}): LoanView[] {
    const memberQuery = filters.member?.trim().toLowerCase();

    return this.loans
      .map((loan) => this.toLoanView(loan))
      .filter((loan) => {
        if (filters.status && loan.status !== filters.status) {
          return false;
        }

        if (!memberQuery) {
          return true;
        }

        return [loan.member.name, loan.member.email, loan.loanCode].some((value) =>
          value.toLowerCase().includes(memberQuery)
        );
      })
      .sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt));
  }

  listOverdueLoans(): LoanView[] {
    return this.listLoans({ status: "overdue" });
  }

  returnLoan(loanId: string): LoanView {
    const loan = this.findLoan(loanId);
    if (loan.returnedAt) {
      throw new BadRequestException("This loan has already been returned.");
    }

    const returnedAt = new Date();
    const book = this.findBook(loan.bookId);
    book.availableCopies = Math.min(book.totalCopies, book.availableCopies + 1);
    loan.returnedAt = returnedAt.toISOString();
    loan.fineThb = calculateFineThb(loan.borrowedAt, loan.dueAt, returnedAt);

    return this.toLoanView(loan);
  }

  buildOverdueReportPdf(): Buffer {
    const loans = this.listOverdueLoans();
    const rows = loans.map((loan) => [
      loan.member.name,
      loan.member.email,
      loan.book.title,
      loan.loanCode,
      formatDate(loan.dueAt),
      `${loan.currentFineThb} THB`
    ]);

    return buildSimplePdf([
      "Overdue Loans Report",
      `Generated: ${formatDate(new Date().toISOString())}`,
      "",
      "Member | Email | Book | Loan Code | Due Date | Fine",
      ...rows.map((row) => row.join(" | ")),
      rows.length === 0 ? "No overdue loans." : ""
    ]);
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

  private createSession(role: UserRole, memberId: string | null): { user: AuthUser; sessionId: string } {
    const session: Session = {
      id: randomBytes(32).toString("hex"),
      role,
      memberId,
      expiresAt: Date.now() + sessionTtlMs
    };

    this.sessions.set(session.id, session);
    return {
      user: this.toAuthUser(session),
      sessionId: session.id
    };
  }

  private findSession(sessionId: string | null): Session | null {
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  private findBook(bookId: string): Book {
    const book = this.books.find((item) => item.id === bookId);
    if (!book) {
      throw new NotFoundException("Book not found.");
    }

    return book;
  }

  private findMember(memberId: string): Member {
    const member = this.members.find((item) => item.id === memberId);
    if (!member) {
      throw new NotFoundException("Member not found.");
    }

    return member;
  }

  private findLoan(loanId: string): Loan {
    const loan = this.loans.find((item) => item.id === loanId);
    if (!loan) {
      throw new NotFoundException("Loan not found.");
    }

    return loan;
  }

  private toAuthUser(session: Session): AuthUser {
    return {
      role: session.role,
      member: session.memberId ? this.toPublicMember(this.findMember(session.memberId)) : null
    };
  }

  private toPublicBook(book: Book): PublicBook {
    return {
      ...book,
      status: book.availableCopies > 0 ? "available" : "unavailable",
      periodDays: loanPeriods[book.category]
    };
  }

  private toPublicMember(member: Member): PublicMember {
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone
    };
  }

  private toLoanView(loan: Loan): LoanView {
    const book = this.findBook(loan.bookId);

    return {
      ...loan,
      status: this.getLoanStatus(loan, new Date()),
      currentFineThb: loan.returnedAt
        ? loan.fineThb
        : calculateFineThb(loan.borrowedAt, loan.dueAt, new Date()),
      book: this.toPublicBook(book),
      member: this.toPublicMember(this.findMember(loan.memberId))
    };
  }

  private getLoanStatus(loan: Loan, referenceDate: Date): LoanStatus {
    if (loan.returnedAt) {
      return "returned";
    }

    return isAfterCalendarDay(referenceDate, new Date(loan.dueAt)) ? "overdue" : "active";
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

function calculateFineThb(borrowedAtIso: string, dueAtIso: string, returnedOrToday: Date): number {
  const borrowedAt = new Date(borrowedAtIso);
  if (isSameCalendarDay(borrowedAt, returnedOrToday)) {
    return 0;
  }

  const dueDate = startOfDay(new Date(dueAtIso));
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimplePdf(lines: string[]): Buffer {
  const objects: string[] = [];
  const content = lines
    .filter((line) => line.length > 0)
    .map((line, index) => `BT /F1 10 Tf 40 ${780 - index * 18} Td (${pdfEscape(line)}) Tj ET`)
    .join("\n");

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);

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
