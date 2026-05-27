const path = require("node:path");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { config } = require("dotenv");

config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
process.env.LIBRARIAN_EMAIL ||= "librarian@example.com";
process.env.LIBRARIAN_PASSWORD ||= "librarian123";
process.env.WEB_ORIGIN ||= "http://localhost:3000";

require("ts-node/register/transpile-only");

const { createApp } = require("../src/create-app");

const prisma = new PrismaClient();
const runId = `case-${Date.now()}`;

let baseUrl = "";
let app = null;

function setNow(value) {
  process.env.LIBRARY_TEST_NOW = value;
}

function clearNow() {
  delete process.env.LIBRARY_TEST_NOW;
}

function iso(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

function dateAt(value) {
  return new Date(`${value}T10:00:00.000Z`);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.headers ?? {})
    }
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { body, headers: response.headers, response };
}

async function requestJson(pathname, options = {}) {
  const result = await request(pathname, {
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return result;
}

function assertOk(result, label) {
  assert(
    result.response.ok,
    `${label}: expected 2xx, got ${result.response.status} ${JSON.stringify(result.body)}`
  );
}

function assertRejected(result, label) {
  assert(
    result.response.status >= 400,
    `${label}: expected rejection, got ${result.response.status} ${JSON.stringify(result.body)}`
  );
}

function cookieFrom(result) {
  const cookie = result.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "expected session cookie");
  return cookie;
}

async function signupMember(label) {
  const email = `${runId}-${label}@example.com`;
  const signup = await requestJson("/members/signup", {
    method: "POST",
    body: {
      name: `Case ${label}`,
      email,
      phone: "+66800000000",
      password: "member123"
    }
  });
  assertOk(signup, `${label} signup`);

  const login = await requestJson("/auth/login", {
    method: "POST",
    body: { email, password: "member123", role: "member" }
  });
  assertOk(login, `${label} login`);
  return { cookie: cookieFrom(login), email, member: login.body.user.member };
}

async function loginLibrarian() {
  const result = await requestJson("/auth/login", {
    method: "POST",
    body: {
      email: process.env.LIBRARIAN_EMAIL,
      password: process.env.LIBRARIAN_PASSWORD,
      role: "librarian"
    }
  });
  assertOk(result, "librarian login");
  return cookieFrom(result);
}

async function createBook(category, copies = 3, label = category) {
  const book = await prisma.book.create({
    data: {
      id: `${runId}-book-${label}`,
      title: `Case ${label}`,
      author: "Verification",
      category,
      totalCopies: copies,
      availableCopies: copies
    }
  });
  return book;
}

async function createMember(label) {
  return prisma.member.create({
    data: {
      id: `${runId}-member-${label}`,
      name: `Case ${label}`,
      email: `${runId}-${label}@example.com`,
      phone: "+66800000000",
      passwordHash: "not-used"
    }
  });
}

async function createLoanRecord({ label, bookId, memberId, borrowedAt, dueAt, returnedAt = null, fineThb = 0 }) {
  return prisma.loan.create({
    data: {
      id: `${runId}-loan-${label}`,
      loanCode: `CASE-${runId}-${label}`.slice(0, 64),
      bookId,
      memberId,
      borrowedAt,
      dueAt,
      returnedAt,
      fineThb
    }
  });
}

async function borrow(cookie, bookId, label) {
  const result = await requestJson("/loans", {
    method: "POST",
    cookie,
    body: { bookId }
  });
  assertOk(result, `${label} borrow`);
  assert.match(result.body.loanCode, /^LL-[A-Z0-9-]+$/);
  return result.body;
}

async function markReturned(librarianCookie, loanId, label) {
  const result = await requestJson(`/loans/${loanId}/return`, {
    method: "POST",
    cookie: librarianCookie
  });
  assertOk(result, `${label} return`);
  return result.body;
}

async function cleanup() {
  clearNow();
  await prisma.loan.deleteMany({ where: { id: { startsWith: `${runId}-` } } });
  await prisma.session.deleteMany({ where: { memberId: { startsWith: `${runId}-` } } });
  await prisma.member.deleteMany({ where: { id: { startsWith: `${runId}-` } } });
  await prisma.book.deleteMany({ where: { id: { startsWith: `${runId}-` } } });
}

async function main() {
  await cleanup();
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  const librarianCookie = await loginLibrarian();

  const catalogNovel = await createBook("novel", 3, "novel");
  const catalogTextbook = await createBook("textbook", 3, "textbook");
  const catalog = await request("/books");
  assertOk(catalog, "case 1 catalog");
  assert(catalog.body.some((book) => book.id === catalogNovel.id), "case 1 catalog includes novel");

  setNow("2026-05-27T10:00:00.000Z");
  const memberOne = await signupMember("member-one");
  const novelLoan = await borrow(memberOne.cookie, catalogNovel.id, "case 1 novel");
  assert.equal(daysBetween(novelLoan.borrowedAt, novelLoan.dueAt), 14, "case 1 novel due date");

  const textbookLoan = await borrow(memberOne.cookie, catalogTextbook.id, "case 2 textbook");
  assert.equal(daysBetween(textbookLoan.borrowedAt, textbookLoan.dueAt), 3, "case 2 textbook due date");

  const sameDayReturn = await markReturned(librarianCookie, textbookLoan.id, "case 3 same-day");
  assert.equal(sameDayReturn.fineThb, 0, "case 3 same-day fine");

  const textbookFixedBook = await createBook("textbook", 1, "textbook-fixed");
  const memberFour = await signupMember("member-four");
  setNow("2026-05-11T10:00:00.000Z");
  const fixedTextbookLoan = await borrow(memberFour.cookie, textbookFixedBook.id, "case 4 fixed textbook");
  assert.equal(iso(fixedTextbookLoan.dueAt), "2026-05-14", "case 4 due date");
  setNow("2026-05-18T10:00:00.000Z");
  const fixedTextbookReturn = await markReturned(librarianCookie, fixedTextbookLoan.id, "case 4 fixed textbook");
  assert.equal(fixedTextbookReturn.fineThb, 40, "case 4 fine");

  const memberFive = await signupMember("member-five");
  setNow("2026-05-27T10:00:00.000Z");
  for (const index of [1, 2, 3]) {
    const book = await createBook("general", 1, `limit-${index}`);
    await borrow(memberFive.cookie, book.id, `case 5 loan ${index}`);
  }
  const fourthBook = await createBook("general", 1, "limit-4");
  const fourthBorrow = await requestJson("/loans", {
    method: "POST",
    cookie: memberFive.cookie,
    body: { bookId: fourthBook.id }
  });
  assertRejected(fourthBorrow, "case 5 fourth borrow");
  assert.match(JSON.stringify(fourthBorrow.body), /3 active loans/i);

  const wrongPassword = await requestJson("/auth/login", {
    method: "POST",
    body: {
      email: memberOne.email,
      password: "wrong-password",
      role: "member"
    }
  });
  assertRejected(wrongPassword, "case 6 wrong password");

  const overdueMember = await signupMember("member-seven");
  const overdueBook = await createBook("textbook", 1, "overdue-existing");
  const overdueBorrowTarget = await createBook("general", 1, "overdue-target");
  await createLoanRecord({
    label: "overdue-existing",
    bookId: overdueBook.id,
    memberId: overdueMember.member.id,
    borrowedAt: dateAt("2026-05-01"),
    dueAt: dateAt("2026-05-04")
  });
  setNow("2026-05-18T10:00:00.000Z");
  const overdueBorrow = await requestJson("/loans", {
    method: "POST",
    cookie: overdueMember.cookie,
    body: { bookId: overdueBorrowTarget.id }
  });
  assertRejected(overdueBorrow, "case 7 overdue member borrow");
  assert.match(JSON.stringify(overdueBorrow.body), /overdue loan/i);

  const generalFixedBook = await createBook("general", 1, "general-fixed");
  const memberEight = await signupMember("member-eight");
  setNow("2026-04-27T10:00:00.000Z");
  const generalLoan = await borrow(memberEight.cookie, generalFixedBook.id, "case 8 fixed general");
  assert.equal(iso(generalLoan.dueAt), "2026-05-04", "case 8 due date");
  setNow("2026-05-18T10:00:00.000Z");
  const generalReturn = await markReturned(librarianCookie, generalLoan.id, "case 8 fixed general");
  assert.equal(generalReturn.fineThb, 200, "case 8 fine");

  const reportBookOne = await createBook("textbook", 1, "report-one");
  const reportBookTwo = await createBook("general", 1, "report-two");
  const reportMemberOne = await createMember("report-one");
  const reportMemberTwo = await createMember("report-two");
  await createLoanRecord({
    label: "report-one",
    bookId: reportBookOne.id,
    memberId: reportMemberOne.id,
    borrowedAt: dateAt("2026-05-01"),
    dueAt: dateAt("2026-05-04")
  });
  await createLoanRecord({
    label: "report-two",
    bookId: reportBookTwo.id,
    memberId: reportMemberTwo.id,
    borrowedAt: dateAt("2026-04-27"),
    dueAt: dateAt("2026-05-04")
  });
  setNow("2026-05-18T10:00:00.000Z");
  const overdueReport = await request("/reports/overdue.pdf", {
    method: "GET",
    cookie: librarianCookie
  });
  assertOk(overdueReport, "case 9 overdue report");
  assert.equal(overdueReport.headers.get("content-type"), "application/pdf");
  const pdfText = overdueReport.body.toString("latin1");
  assert.match(pdfText, /Case report-one/);
  assert.match(pdfText, /Case report-two/);
  assert.match(pdfText, /200 THB/);

  console.log("All 9 lending rules passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await app?.close();
    await prisma.$disconnect();
  });
