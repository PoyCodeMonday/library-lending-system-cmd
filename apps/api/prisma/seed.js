const { PrismaClient } = require("@prisma/client");
const { randomBytes, scryptSync } = require("node:crypto");

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function main() {
  const books = [
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

  for (const book of books) {
    await prisma.book.upsert({
      where: { id: book.id },
      update: {},
      create: book
    });
  }

  const members = [
    {
      id: "member-nina",
      name: "Nina Patel",
      email: "nina@example.com",
      phone: "+66812345678",
      passwordHash: hashPassword("member123")
    },
    {
      id: "member-theo",
      name: "Theo Morgan",
      email: "theo@example.com",
      phone: "+66887654321",
      passwordHash: hashPassword("member123")
    }
  ];

  for (const member of members) {
    await prisma.member.upsert({
      where: { email: member.email },
      update: {},
      create: member
    });
  }

  await prisma.session.upsert({
    where: { id: "seed-librarian-session" },
    update: {
      expiresAt: addDays(new Date(), -1)
    },
    create: {
      id: "seed-librarian-session",
      role: "librarian",
      memberId: null,
      expiresAt: addDays(new Date(), -1)
    }
  });

  const borrowedNina = addDays(new Date(), -6);
  const borrowedTheo = addDays(new Date(), -2);
  const loans = [
    {
      id: "loan-existing-1",
      loanCode: "LL-1001",
      bookId: "book-designing-data-intensive-apps",
      memberId: "member-nina",
      borrowedAt: borrowedNina,
      dueAt: addDays(borrowedNina, 3),
      returnedAt: null,
      fineThb: 0
    },
    {
      id: "loan-existing-2",
      loanCode: "LL-1002",
      bookId: "book-designing-data-intensive-apps",
      memberId: "member-theo",
      borrowedAt: borrowedTheo,
      dueAt: addDays(borrowedTheo, 3),
      returnedAt: null,
      fineThb: 0
    }
  ];

  for (const loan of loans) {
    await prisma.loan.upsert({
      where: { loanCode: loan.loanCode },
      update: {},
      create: loan
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
