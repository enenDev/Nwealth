"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// function to serialize transaction, as nextJS doesn't support decimals hence converting balance to number
const serializeTransaction = (obj) => {
  const serialized = { ...obj };
  if (obj.balance) {
    serialized.balance = obj.balance.toNumber();
  }

  if (obj.amount) {
    serialized.amount = obj.amount.toNumber();
  }

  return serialized;
};

export async function updateDefaultAccount(accountID) {
  try {
    // checking for the user first
    const { userId } = await auth();
    // check if user exists or not in clerk
    if (!userId) throw new Error("Unauthorized");

    // similarly we have to check if user exists in database
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId, // clerkUserId is col name in db of user table
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // setting all the accounts of this user if to false
    await db.account.updateMany({
      where: {
        userId: user.id,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });

    // setting the current account as default one
    const account = await db.account.update({
      where: {
        id: accountID,
        userId: user.id,
      },
      data: {
        isDefault: true,
      },
    });

    revalidatePath("/dashboard");
    return { success: true, data: serializeTransaction(account) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// get the respective account details
export async function getAccountWithTransactions(accountId) {
  try {
    // checking for the user first
    const { userId } = await auth();
    // check if user exists or not in clerk
    if (!userId) throw new Error("Unauthorized");

    // similarly we have to check if user exists in database
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId, // clerkUserId is col name in db of user table
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // getting the account details with transactions based on accountid
    const account = await db.account.findUnique({
      where: {
        id: accountId,
        userId: user.id,
      },
      include: {
        transactions: {
          orderBy: { date: "desc" },
        },
        _count: {
          select: {
            transactions: true,
          },
        },
      },
    });

    if (!account) return null;

    // returning serialized account
    return {
      ...serializeTransaction(account),
      transactions: account.transactions.map(serializeTransaction),
    };
  } catch (error) {}
}

// action for bulk delete transaction and updating account balace
export async function bulkDeleteTransaction(transactionIds) {
  try {
    // checking for the user first
    const { userId } = await auth();
    // check if user exists or not in clerk
    if (!userId) throw new Error("Unauthorized");

    // similarly we have to check if user exists in database
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId, // clerkUserId is col name in db of user table
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // get the transactions as per transaction id to calculate the balance changes

    // Get transactions to calculate balance changes
    const transactions = await db.transaction.findMany({
      where: {
        id: { in: transactionIds },
        userId: user.id,
      },
    });

    // grouping/mapping the transactions based on account id
    const accountBalanceChanges = transactions.reduce((acc, transaction) => {
      const change =
        transaction.type === "EXPENSE"
          ? transaction.amount
          : -transaction.amount;
      acc[transaction.accountId] = (acc[transaction.accountId] || 0) + change;

      return acc;
    }, {});

    // Delete transaction and update account balance in a transaction
    await db.$transaction(async (tx) => {
      // Delete transaction

      await tx.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
          userId: user.id,
        },
      });

      // update account balances
      // iterating over the accountBalanceChanges and updating the respective account balances
      for (const [accountId, balanceChange] of Object.entries(
        accountBalanceChanges
      )) {
        await tx.account.update({
          where: {
            id: accountId,
          },
          data: {
            balance: {
              increment: balanceChange,
            },
          },
        });
      }
    });

    revalidatePath("/dashboard");
    revalidatePath("account/[id]");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
