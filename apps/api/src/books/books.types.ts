export type BookCategory = "textbook" | "general" | "novel";
export type BookStatus = "available" | "unavailable";
export type LoanStatus = "active" | "overdue" | "returned";
export type UserRole = "member" | "librarian";

export interface Book {
  id: string;
  title: string;
  author: string;
  category: BookCategory;
  totalCopies: number;
  availableCopies: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  id: string;
  role: UserRole;
  memberId: string | null;
  expiresAt: number;
}

export interface Loan {
  id: string;
  loanCode: string;
  bookId: string;
  memberId: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  fineThb: number;
}

export interface PublicMember {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface PublicBook extends Book {
  status: BookStatus;
  periodDays: number;
}

export interface LoanView extends Loan {
  status: LoanStatus;
  currentFineThb: number;
  book: PublicBook;
  member: PublicMember;
}

export interface AuthUser {
  role: UserRole;
  member: PublicMember | null;
}
