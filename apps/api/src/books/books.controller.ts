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
import { BookCategory, LoanStatus, Session, UserRole } from "./books.types";
import { AddBookDto } from "./dto/add-book.dto";
import { CreateLoanDto } from "./dto/create-loan.dto";
import { LoginDto } from "./dto/login.dto";
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
  signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    const auth = this.booksService.signup(dto);
    setSessionCookie(response, auth.sessionId);
    return { user: auth.user };
  }

  @Post("auth/login")
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    const auth = this.booksService.login(dto);
    setSessionCookie(response, auth.sessionId);
    return { user: auth.user };
  }

  @Post("auth/logout")
  logout(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse
  ) {
    this.booksService.logout(readSessionId(request));
    clearSessionCookie(response);
    return { ok: true };
  }

  @Get("auth/me")
  me(@Req() request: HttpRequest) {
    return { user: this.booksService.getAuthUser(readSessionId(request)) };
  }

  @Get("books")
  listBooks(@Query("query") query?: string, @Query("category") category?: BookCategory) {
    return this.booksService.listBooks({ query, category });
  }

  @Post("books")
  addBook(@Body() dto: AddBookDto, @Req() request: HttpRequest) {
    requireRole(this.getSession(request), "librarian");
    return this.booksService.addBook(dto);
  }

  @Post("loans")
  createLoan(@Body() dto: CreateLoanDto, @Req() request: HttpRequest) {
    const session = requireRole(this.getSession(request), "member");
    if (!session.memberId) {
      throw new UnauthorizedException("Member session required.");
    }

    return this.booksService.createLoan(dto, session.memberId);
  }

  @Get("me/loans")
  memberLoans(@Req() request: HttpRequest) {
    const session = requireRole(this.getSession(request), "member");
    if (!session.memberId) {
      throw new UnauthorizedException("Member session required.");
    }

    return this.booksService.listMemberLoans(session.memberId);
  }

  @Get("loans")
  listLoans(
    @Req() request: HttpRequest,
    @Query("member") member?: string,
    @Query("status") status?: LoanStatus
  ) {
    requireRole(this.getSession(request), "librarian");
    return this.booksService.listLoans({ member, status });
  }

  @Get("loans/overdue")
  overdueLoans(@Req() request: HttpRequest) {
    requireRole(this.getSession(request), "librarian");
    return this.booksService.listOverdueLoans();
  }

  @Post("loans/:id/return")
  returnLoan(@Param("id") id: string, @Req() request: HttpRequest) {
    requireRole(this.getSession(request), "librarian");
    return this.booksService.returnLoan(id);
  }

  @Get("reports/overdue.pdf")
  overdueReport(@Req() request: HttpRequest, @Res() response: HttpResponse) {
    requireRole(this.getSession(request), "librarian");
    const pdf = this.booksService.buildOverdueReportPdf();
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", "attachment; filename=\"overdue-report.pdf\"");
    response.send(pdf);
  }

  private getSession(request: HttpRequest): Session | null {
    const user = this.booksService.getAuthUser(readSessionId(request));
    const sessionId = readSessionId(request);
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
