"use client";

import {
  BookOpen,
  Check,
  CircleAlert,
  Download,
  LibraryBig,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type BookCategory = "textbook" | "general" | "novel";
type LoanStatus = "active" | "overdue" | "returned";
type UserRole = "member" | "librarian";

interface PublicMember {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface AuthUser {
  role: UserRole;
  member: PublicMember | null;
}

interface Book {
  id: string;
  title: string;
  author: string;
  category: BookCategory;
  totalCopies: number;
  availableCopies: number;
  status: "available" | "unavailable";
  periodDays: number;
}

interface Loan {
  id: string;
  loanCode: string;
  bookId: string;
  memberId: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  fineThb: number;
  status: LoanStatus;
  currentFineThb: number;
  book: Book;
  member: PublicMember;
}

interface Rules {
  categories: Array<{
    category: BookCategory;
    description: string;
    periodDays: number;
  }>;
  finePerOverdueWeekdayThb: number;
  maxActiveLoansPerMember: number;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const categoryOptions: BookCategory[] = ["textbook", "general", "novel"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(error?.message) ? error.message.join(" ") : error?.message;
    throw new Error(message ?? "Request failed.");
  }

  return response.json() as Promise<T>;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return readJson<T>(
    await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    })
  );
}

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [memberLoans, setMemberLoans] = useState<Loan[]>([]);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | BookCategory>("all");
  const [loanFilter, setLoanFilter] = useState("");
  const [authMode, setAuthMode] = useState<"signup" | "member" | "librarian">("signup");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return books.filter((book) => {
      const matchesCategory = category === "all" || book.category === category;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [book.title, book.author, book.category].some((value) =>
          value.toLowerCase().includes(normalizedQuery)
        );

      return matchesCategory && matchesQuery;
    });
  }, [books, query, category]);

  const activeMemberLoans = memberLoans.filter((loan) => loan.status !== "returned");
  const loanHistory = memberLoans.filter((loan) => loan.status === "returned");
  const activeLoans = allLoans.filter((loan) => loan.status !== "returned");
  const overdueLoans = allLoans.filter((loan) => loan.status === "overdue");
  const visibleActiveLoans = activeLoans.filter((loan) => {
    const normalized = loanFilter.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return [loan.member.name, loan.member.email, loan.loanCode, loan.book.title].some((value) =>
      value.toLowerCase().includes(normalized)
    );
  });

  const stats = {
    titles: books.length,
    copies: books.reduce((sum, book) => sum + book.totalCopies, 0),
    available: books.reduce((sum, book) => sum + book.availableCopies, 0),
    overdue: overdueLoans.length
  };

  async function loadBaseData() {
    const [booksData, rulesData, meData] = await Promise.all([
      api<Book[]>("/books"),
      api<Rules>("/rules"),
      api<{ user: AuthUser | null }>("/auth/me")
    ]);

    setBooks(booksData);
    setRules(rulesData);
    setUser(meData.user);

    if (meData.user?.role === "member") {
      setMemberLoans(await api<Loan[]>("/me/loans"));
      setAllLoans([]);
    } else if (meData.user?.role === "librarian") {
      setAllLoans(await api<Loan[]>("/loans"));
      setMemberLoans([]);
    } else {
      setMemberLoans([]);
      setAllLoans([]);
    }
  }

  async function refreshForRole(currentUser = user) {
    setBooks(await api<Book[]>("/books"));

    if (currentUser?.role === "member") {
      setMemberLoans(await api<Loan[]>("/me/loans"));
    }

    if (currentUser?.role === "librarian") {
      setAllLoans(await api<Loan[]>("/loans"));
    }
  }

  useEffect(() => {
    loadBaseData()
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Unable to load library data.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const body =
        authMode === "signup"
          ? {
              name: String(form.get("name") ?? ""),
              email: String(form.get("email") ?? ""),
              phone: String(form.get("phone") ?? ""),
              password: String(form.get("password") ?? "")
            }
          : {
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
              role: authMode
            };

      const auth = await api<{ user: AuthUser }>(
        authMode === "signup" ? "/members/signup" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );

      setUser(auth.user);
      setSuccess(auth.user.role === "librarian" ? "Librarian signed in." : "Member signed in.");
      await refreshForRole(auth.user);
      event.currentTarget.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to sign in.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api<{ ok: true }>("/auth/logout", { method: "POST" });
      setUser(null);
      setMemberLoans([]);
      setAllLoans([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to log out.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBorrow(bookId: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const loan = await api<Loan>("/loans", {
        method: "POST",
        body: JSON.stringify({ bookId })
      });
      setSuccess(`Loan ${loan.loanCode} created. Due ${formatDate(loan.dueAt)}.`);
      await refreshForRole();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to borrow this book.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api<Book>("/books", {
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          author: String(form.get("author") ?? ""),
          category: String(form.get("category") ?? "general"),
          copies: Number(form.get("copies") ?? 1)
        })
      });
      setSuccess("Book added to catalog.");
      event.currentTarget.reset();
      await refreshForRole();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to add book.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReturnLoan(loanId: string) {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const loan = await api<Loan>(`/loans/${loanId}/return`, { method: "POST" });
      setSuccess(`Returned ${loan.loanCode}. Fine: ${loan.fineThb} THB.`);
      await refreshForRole();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to return loan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <LibraryBig size={24} />
        </div>
        <div>
          <p className="eyebrow">Private library</p>
          <h1>Library Lending</h1>
        </div>
        {user ? (
          <button className="ghost-button topbar-action" onClick={() => void handleLogout()} type="button">
            <LogOut size={17} />
            <span>Logout</span>
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="notice error" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}
      {success ? (
        <div className="notice success" role="status">
          <Check size={18} />
          <span>{success}</span>
        </div>
      ) : null}

      <section className="metrics-grid" aria-label="Library summary">
        <Metric label="Titles" value={stats.titles} />
        <Metric label="Copies" value={stats.copies} />
        <Metric label="Available" value={stats.available} />
        <Metric label="Overdue" value={stats.overdue} />
      </section>

      <section className="workspace">
        <section className="catalog-panel">
          <div className="panel-header">
            <div>
              <h2>Catalog</h2>
              <p>{filteredBooks.length} matching titles</p>
            </div>
            <div className="status-tabs" role="tablist" aria-label="Category filter">
              {(["all", ...categoryOptions] as const).map((item) => (
                <button
                  className={category === item ? "active" : ""}
                  key={item}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search books"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, author, category"
              type="search"
              value={query}
            />
          </label>

          <div className="book-list">
            {loading ? (
              <div className="loading-state">
                <Loader2 className="spin" size={20} />
                <span>Loading</span>
              </div>
            ) : (
              filteredBooks.map((book) => (
                <article className="book-card" key={book.id}>
                  <div className="book-spine" aria-hidden="true" />
                  <div className="book-main">
                    <div>
                      <h3>{book.title}</h3>
                      <p>{book.author}</p>
                    </div>
                    <div className="book-meta">
                      <span>{book.category}</span>
                      <span>{book.periodDays} days</span>
                      <span>{book.availableCopies} available</span>
                    </div>
                  </div>
                  <div className="availability">
                    <strong>{book.availableCopies}</strong>
                    <span>of {book.totalCopies}</span>
                  </div>
                  {user?.role === "member" ? (
                    <button
                      className="book-action"
                      disabled={saving || book.availableCopies === 0}
                      onClick={() => void handleBorrow(book.id)}
                      type="button"
                    >
                      <BookOpen size={17} />
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <aside className="side-panel">
          {!user ? (
            <AuthPanel authMode={authMode} onAuthModeChange={setAuthMode} onSubmit={handleAuth} saving={saving} />
          ) : null}

          {user?.role === "member" ? (
            <MemberPanel
              activeLoans={activeMemberLoans}
              history={loanHistory}
              member={user.member}
              rules={rules}
            />
          ) : null}

          {user?.role === "librarian" ? (
            <LibrarianPanel
              activeLoans={visibleActiveLoans}
              loanFilter={loanFilter}
              onAddBook={handleAddBook}
              onFilterChange={setLoanFilter}
              onReturnLoan={handleReturnLoan}
              overdueLoans={overdueLoans}
              saving={saving}
            />
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuthPanel({
  authMode,
  onAuthModeChange,
  onSubmit,
  saving
}: {
  authMode: "signup" | "member" | "librarian";
  onAuthModeChange: (mode: "signup" | "member" | "librarian") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <form className="tool-panel form-grid" onSubmit={onSubmit}>
      <div className="panel-header compact">
        <div>
          <h2>Account</h2>
          <p>{authMode === "librarian" ? "Librarian access" : "Member access"}</p>
        </div>
        {authMode === "librarian" ? <ShieldCheck size={22} /> : <UserPlus size={22} />}
      </div>

      <div className="status-tabs stretch">
        <button
          className={authMode === "signup" ? "active" : ""}
          onClick={() => onAuthModeChange("signup")}
          type="button"
        >
          Sign up
        </button>
        <button
          className={authMode === "member" ? "active" : ""}
          onClick={() => onAuthModeChange("member")}
          type="button"
        >
          Member
        </button>
        <button
          className={authMode === "librarian" ? "active" : ""}
          onClick={() => onAuthModeChange("librarian")}
          type="button"
        >
          Librarian
        </button>
      </div>

      {authMode === "signup" ? (
        <>
          <Field label="Name" name="name" placeholder="Member name" />
          <Field label="Phone" name="phone" placeholder="+66812345678" />
        </>
      ) : null}
      <Field label="Email" name="email" placeholder="name@example.com" type="email" />
      <Field label="Password" name="password" placeholder="Minimum 6 characters" type="password" />

      <button className="primary-button" disabled={saving} type="submit">
        {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
        <span>{authMode === "signup" ? "Create account" : "Login"}</span>
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
  type = "text",
  min
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input min={min} name={name} placeholder={placeholder} required type={type} />
    </label>
  );
}

function MemberPanel({
  activeLoans,
  history,
  member,
  rules
}: {
  activeLoans: Loan[];
  history: Loan[];
  member: PublicMember | null;
  rules: Rules | null;
}) {
  return (
    <>
      <section className="tool-panel">
        <div className="panel-header compact">
          <div>
            <h2>{member?.name ?? "Member"}</h2>
            <p>{activeLoans.length} active loans</p>
          </div>
          <BookOpen size={22} />
        </div>
        <LoanList loans={activeLoans} />
      </section>

      <section className="tool-panel rules-panel">
        <h2>Loan Rules</h2>
        {rules?.categories.map((item) => (
          <div className="rule-row" key={item.category}>
            <span>{item.category}</span>
            <strong>{item.periodDays} days</strong>
          </div>
        ))}
        <p>{rules?.finePerOverdueWeekdayThb ?? 20} THB per overdue weekday</p>
      </section>

      <section className="tool-panel">
        <div className="panel-header compact">
          <div>
            <h2>History</h2>
            <p>{history.length} returned loans</p>
          </div>
          <Check size={22} />
        </div>
        <LoanList loans={history} />
      </section>
    </>
  );
}

function LibrarianPanel({
  activeLoans,
  loanFilter,
  onAddBook,
  onFilterChange,
  onReturnLoan,
  overdueLoans,
  saving
}: {
  activeLoans: Loan[];
  loanFilter: string;
  onAddBook: (event: FormEvent<HTMLFormElement>) => void;
  onFilterChange: (value: string) => void;
  onReturnLoan: (loanId: string) => void;
  overdueLoans: Loan[];
  saving: boolean;
}) {
  return (
    <>
      <form className="tool-panel form-grid" onSubmit={onAddBook}>
        <div className="panel-header compact">
          <div>
            <h2>Add Book</h2>
            <p>Catalog management</p>
          </div>
          <Plus size={22} />
        </div>
        <Field label="Title" name="title" placeholder="Book title" />
        <Field label="Author" name="author" placeholder="Author name" />
        <label className="field">
          <span>Category</span>
          <select name="category" required defaultValue="general">
            {categoryOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <Field label="Copies" min={1} name="copies" placeholder="1" type="number" />
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
          <span>Add book</span>
        </button>
      </form>

      <section className="tool-panel">
        <div className="panel-header compact">
          <div>
            <h2>Active Loans</h2>
            <p>{activeLoans.length} open loans</p>
          </div>
          <RotateCcw size={22} />
        </div>
        <label className="search-field tight">
          <Search size={18} />
          <input
            aria-label="Filter loans by member"
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="Member, email, loan code"
            value={loanFilter}
          />
        </label>
        <LoanList loans={activeLoans} onReturnLoan={onReturnLoan} saving={saving} />
      </section>

      <section className="tool-panel">
        <div className="panel-header compact">
          <div>
            <h2>Overdue</h2>
            <p>{overdueLoans.length} loans need attention</p>
          </div>
          <a className="icon-link" href={`${apiUrl}/reports/overdue.pdf`} target="_blank">
            <Download size={18} />
          </a>
        </div>
        <LoanList loans={overdueLoans} onReturnLoan={onReturnLoan} saving={saving} />
      </section>
    </>
  );
}

function LoanList({
  loans,
  onReturnLoan,
  saving
}: {
  loans: Loan[];
  onReturnLoan?: (loanId: string) => void;
  saving?: boolean;
}) {
  if (loans.length === 0) {
    return <div className="empty-state">No loans</div>;
  }

  return (
    <div className="loan-list">
      {loans.map((loan) => (
        <article className={`loan-row ${loan.status}`} key={loan.id}>
          <div>
            <strong>{loan.book.title}</strong>
            <span>
              {loan.member.name} · {loan.loanCode}
            </span>
            <small>
              Due {formatDate(loan.dueAt)} · Fine {loan.currentFineThb} THB
            </small>
          </div>
          {onReturnLoan && loan.status !== "returned" ? (
            <button
              aria-label={`Return ${loan.loanCode}`}
              disabled={saving}
              onClick={() => onReturnLoan(loan.id)}
              type="button"
            >
              <RotateCcw size={17} />
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
