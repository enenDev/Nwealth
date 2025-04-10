import { db } from "@/lib/prisma";
import { inngest } from "./client";
import { sendEmail } from "@/actions/send-email";
import EmailTemplate from "@/emails/template";
import { date } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const checkBudgetAlert = inngest.createFunction(
  { name: "check budget alerts" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    // getting the budgets of all accounts for the current uer
    const budgets = await step.run("fetch-budget", async () => {
      return await db.budget.findMany({
        include: {
          user: {
            include: {
              accounts: {
                where: {
                  isDefault: true,
                },
              },
            },
          },
        },
      });
    });

    // iterating each budget, calculating the expenses and percentage used and accordingly sending mail to user
    // for loop on budget
    for (const budget of budgets) {
      // check default account
      const defaultAccount = budget.user.accounts[0];
      if (!defaultAccount) continue; // skip if not default account

      // run the check budget cron job
      await step.run(`check-budget-${budget.id}`, async () => {
        // getting the start date of month

        const currentDate = new Date();

        const startOfMonth = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          1
        );
        const endOfMonth = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          0
        );

        // calculate the total expense for default account only
        const expenses = await db.transaction.aggregate({
          where: {
            userId: budget.userId,
            accountId: defaultAccount.id,
            type: "EXPENSE",
            date: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
          _sum: {
            amount: true,
          },
        });

        const totalExpenses = expenses._sum.amount?.toNumber() || 0;
        const budgetAmount = budget.amount;
        const percentageUsed = (totalExpenses / budgetAmount) * 100;

        // check if we should send an alert or not
        // we'll check for percentageUsed is >=80 and have we sent last alert in this month or not
        if (
          (percentageUsed >= 80 && !budget.lastAlertSent) ||
          isNewMonth(new Date(budget.lastAlertSent), new Date())
        ) {
          // send email
          await sendEmail({
            to: budget.user.email,
            subject: `Budget Alert for ${defaultAccount.name}`,
            react: EmailTemplate({
              type: "budget-alert",
              userName: budget.user.name,
              data: {
                percentageUsed,
                budgetAmount: parseInt(budgetAmount).toFixed(1),
                totalExpenses: parseInt(totalExpenses).toFixed(1),
                accountName: defaultAccount.name,
              },
            }),
          });
          // update the last alert sent
          await db.budget.update({
            where: {
              id: budget.id,
            },
            data: { lastAlertSent: new Date() },
          });
        }
      });
    }
  }
);

// function to check is new month
function isNewMonth(lastAlertDate, currentDate) {
  return (
    lastAlertDate.getMonth() !== currentDate.getMonth() ||
    lastAlertDate.getFullYear() !== currentDate.getFullYear()
  );
}

// setting cron job for adding the expense/income for recurring transaction
export const triggerRecurringTransactions = inngest.createFunction(
  {
    id: "trigger-recurring-transactions",
    name: "Trigger Recurring Transactions",
  },
  {
    cron: "0 0 * * *",
  },
  async ({ step }) => {
    // 1. Fetch All due recurring transactions
    const recurringTransaction = await step.run(
      "fetch-recurring-transactions",
      async () => {
        return await db.transaction.findMany({
          where: {
            isRecurring: true,
            status: "COMPLETED",
            OR: [
              { lastProcessed: null },
              { nextRecurringDate: { lte: new Date() } },
            ],
          },
        });
      }
    );
    // 2. create events for these recurring transactions
    if (recurringTransaction.length > 0) {
      const events = recurringTransaction.map((transaction) => ({
        name: "transaction.recurring.process",
        data: {
          transactionId: transaction.id,
          userId: transaction.userId,
        },
      }));

      // 3. send events to be processed
      await inngest.send(events);
    }

    return { triggered: recurringTransaction.length };
  }
);

export const processRecurringTransaction = inngest.createFunction(
  {
    id: "process-recurring-transaction",
    name: "Process Recurring Transaction",
    throttle: {
      limit: 10, // only process 10 transactions
      period: "1m", // per minute
      key: "event.data.userId", // per user
    },
  },
  {
    event: "transaction.recurring.process",
  },
  async ({ event, step }) => {
    // validate event data
    if (!event?.data?.transactionId || !event?.data?.userId) {
      console.error("Invalid event data: ", event);
      return {
        error: "Missing required event data",
      };
    }

    await step.run("process-transaction", async () => {
      // fetching the current transaction details by transactionid and userid
      const transaction = await db.transaction.findUnique({
        where: {
          id: event.data.transactionId,
          userId: event.data.userId,
        },
        include: {
          account: true,
        },
      });
      // check if transaction doesn't exists or the date is not due, then simply return
      if (!transaction || !isTransactionDue(transaction)) return;

      await db.$transaction(async (tx) => {
        // create new transaction
        await tx.transaction.create({
          data: {
            type: transaction.type,
            amount: transaction.amount,
            description: ` ${transaction.description} (Recurring)`,
            date: new Date(),
            category: transaction.category,
            userId: transaction.userId,
            accountId: transaction.accountId,
            isRecurring: false,
          },
        });

        // update account balance
        const balanceChange =
          transaction.type === "EXPENSE"
            ? -transaction.amount.toNumber()
            : transaction.amount.toNumber();

        await tx.account.update({
          where: {
            id: transaction.accountId,
          },
          data: {
            balance: {
              increment: balanceChange,
            },
          },
        });

        // update last processed date and next recurring date
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            lastProcessed: new Date(),
            nextRecurringDate: calculateNextRecurringDate(
              new Date(),
              transaction.recurringInterval
            ),
          },
        });
      });
    });
  }
);

// setting cron job for sending monthly insights to user
export const generateMonthlyReports = inngest.createFunction(
  {
    id: "generate-monthly-report",
    name: "Generate Monthly Report",
  },
  { cron: "0 0 1 * *" },
  async ({ step }) => {
    // 1. run step for getting the users data
    const users = await step.run("fetch-users", async () => {
      return await db.user.findMany({
        include: {
          accounts: true,
        },
      });
    });

    // 2. Iterate user data
    for (const user of users) {
      await step.run(`generate-report-${user.id}`, async () => {
        // 2.1 get the monthly stats
        // get the last month for getting the transactions details from last to current month
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        const stats = await getMonthlyStats(user.id, lastMonth);
        // generating the full name of the month
        const monthName = lastMonth.toLocaleString("default", {
          month: "long",
        });

        // 2.2 get the insights using genAi
        const insights = await generateFinancialInsights(stats, monthName);

        // 2.3 send the email using above 2 points
        await sendEmail({
          to: user.email,
          subject: `Your Monthly Financial Report for ${monthName}`,
          react: EmailTemplate({
            userName: user.name,
            type: "monthly-report",
            data: {
              stats,
              month: monthName,
              insights,
            },
          }),
        });
      });
    }

    // return processed users
    return {
      processed: users.length,
    };
  }
);

// handler to generate insights from genAI
async function generateFinancialInsights(stats, month) {
  const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAi.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
    Analyze this financial data and provide 3 concise, actionable insights.
    Focus on spending patterns and practical advice.
    Keep it friendly and conversational.

    Financial Data for ${month}:
    - Total Income: $${stats.totalIncome}
    - Total Expenses: $${stats.totalExpenses}
    - Net Income: $${stats.totalIncome - stats.totalExpenses}
    - Expense Categories: ${Object.entries(stats.byCategory)
      .map(([category, amount]) => `${category}: $${amount}`)
      .join(", ")}

    Format the response as a JSON array of strings, like this:
    ["insight 1", "insight 2", "insight 3"]
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Error generating insights:", error);
    return [
      "Your highest expense category this month might need attention.",
      "Consider setting up a budget for better financial management.",
      "Track your recurring expenses to identify potential savings.",
    ];
  }
}

// handler to check isTransactionDue
function isTransactionDue(transaction) {
  // if no processedLastDate, then transaction is due
  if (!transaction.lastProcessed) return true;

  const today = new Date();
  const nextDue = new Date(transaction.nextRecurringDate);

  return nextDue <= today;
}

// Helper function to calculate next recurring date
function calculateNextRecurringDate(startDate, interval) {
  const date = new Date(startDate);

  switch (interval) {
    case "DAILY":
      date.setDate(date.getDate() + 1);
      break;
    case "WEEKLY":
      date.setDate(date.getDate() + 7);
      break;
    case "MONTHLY":
      date.setMonth(date.getMonth() + 1);
      break;
    case "YEARLY":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
}

// handler to get the monthly stats
async function getMonthlyStats(userId, month) {
  // get start & end date
  const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
  const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  // get the transactions of the respective user between start & end date
  const transactions = await db.transaction.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  // transform the transactions in the object
  return transactions.reduce(
    (stats, t) => {
      const amount = t.amount.toNumber();
      // checking for type is expense/income and accordingly updating each object
      if (t.type === "EXPENSE") {
        stats.totalExpenses += amount;
        stats.byCategory[t.category] =
          (stats.byCategory[t.category] || 0) + amount;
      } else {
        stats.totalIncome += amount;
      }
      return stats;
    },
    {
      totalExpenses: 0,
      totalIncome: 0,
      byCategory: {},
      transactionCount: transactions.length,
    }
  );
}
