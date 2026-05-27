import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { BooksService } from "./books.service";
import type { BookCategory, LoanStatus, Session, UserRole } from "./books.types";
import { AddBookDto } from "./dto/add-book.dto";
import { CreateLoanDto } from "./dto/create-loan.dto";
import { LoginDto } from "./dto/login.dto";
import { ReturnLoanDto } from "./dto/return-loan.dto";
import { SignupDto } from "./dto/signup.dto";

interface HttpRequest {
  headers: {
    cookie?: string;
  };
}

interface HttpResponse {
  setHeader(name: string, value: string | string[]): void;
  send(body: Buffer | string): void;
}

const sessionCookieName = "library_session";

@Controller()
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get("health")
  health() {
    return { status: "ok" };
  }

  @Get("rules")
  rules() {
    return this.booksService.getRules();
  }

  @Post("members/signup")
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    const auth = await this.booksService.signup(dto);
    setSessionCookie(response, auth.sessionId);
    return { user: auth.user };
  }

  @Post("auth/login")
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    const auth = await this.booksService.login(dto);
    setSessionCookie(response, auth.sessionId);
    return { user: auth.user };
  }

  @Post("auth/logout")
  async logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    await this.booksService.logout(readSessionId(request));
    clearSessionCookie(response);
    return { ok: true };
  }

  @Get("auth/me")
  async me(@Req() request: HttpRequest) {
    return { user: await this.booksService.getAuthUser(readSessionId(request)) };
  }

  @Get("books")
  listBooks(@Query("query") query?: string, @Query("category") category?: BookCategory) {
    return this.booksService.listBooks({ query, category });
  }

  @Post("books")
  async addBook(@Body() dto: AddBookDto, @Req() request: HttpRequest) {
    requireRole(await this.getSession(request), "librarian");
    return this.booksService.addBook(dto);
  }

  @Post("loans")
  async createLoan(@Body() dto: CreateLoanDto, @Req() request: HttpRequest) {
    const session = requireRole(await this.getSession(request), "member");
    if (!session.memberId) {
      throw new UnauthorizedException("Member session required.");
    }

    return this.booksService.createLoan(dto, session.memberId);
  }

  @Get("me/loans")
  async memberLoans(@Req() request: HttpRequest) {
    const session = requireRole(await this.getSession(request), "member");
    if (!session.memberId) {
      throw new UnauthorizedException("Member session required.");
    }

    return this.booksService.listMemberLoans(session.memberId);
  }

  @Get("loans")
  async listLoans(
    @Req() request: HttpRequest,
    @Query("member") member?: string,
    @Query("status") status?: LoanStatus
  ) {
    requireRole(await this.getSession(request), "librarian");
    return this.booksService.listLoans({ member, status });
  }

  @Get("loans/overdue")
  async overdueLoans(@Req() request: HttpRequest) {
    requireRole(await this.getSession(request), "librarian");
    return this.booksService.listOverdueLoans();
  }

  @Post("loans/:id/return")
  async returnLoan(@Param("id") id: string, @Body() dto: ReturnLoanDto, @Req() request: HttpRequest) {
    requireRole(await this.getSession(request), "librarian");
    return this.booksService.returnLoan(id, dto);
  }

  @Get("reports/overdue.pdf")
  async overdueReport(@Req() request: HttpRequest, @Res() response: HttpResponse) {
    requireRole(await this.getSession(request), "librarian");
    const pdf = await this.booksService.buildOverdueReportPdf();
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", "attachment; filename=\"overdue-report.pdf\"");
    response.send(pdf);
  }

  private async getSession(request: HttpRequest): Promise<Session | null> {
    const sessionId = readSessionId(request);
    const user = await this.booksService.getAuthUser(sessionId);
    if (!user || !sessionId) {
      return null;
    }

    return {
      id: sessionId,
      role: user.role,
      memberId: user.member?.id ?? null,
      expiresAt: Date.now()
    };
  }
}

function requireRole(session: Session | null, role: UserRole): Session {
  if (!session || session.role !== role) {
    throw new UnauthorizedException(`${role} access required.`);
  }

  return session;
}

function readSessionId(request: HttpRequest): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return null;
  }

  const sessionCookie = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookieName}=`));

  return sessionCookie ? decodeURIComponent(sessionCookie.split("=")[1] ?? "") : null;
}

function setSessionCookie(response: HttpResponse, sessionId: string): void {
  const production = process.env.NODE_ENV === "production";
  const sameSite = production ? "SameSite=None" : "SameSite=Lax";
  const secure = production ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(
      sessionId
    )}; HttpOnly; ${sameSite}; Path=/; Max-Age=28800${secure}`
  );
}

function clearSessionCookie(response: HttpResponse): void {
  const production = process.env.NODE_ENV === "production";
  const sameSite = production ? "SameSite=None" : "SameSite=Lax";
  const secure = production ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; HttpOnly; ${sameSite}; Path=/; Max-Age=0${secure}`
  );
}
