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

// function to create account
export async function createAccount(data) {
  try {
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

    // converting the balance to float before saving
    const balanceFloat = parseFloat(data.balance);
    if (isNaN(balanceFloat)) {
      throw new Error("Invalid balance amount");
    }

    // check if user's first account or the second account
    const existingAccounts = await db.account.findMany({
      where: {
        userId: user.id,
      },
    });

    // checking for default account
    const shouldBeDefault =
      existingAccounts.length === 0 ? true : user.isDefault;

    // if current account has to be default, then make all other accounts as not default
    if (shouldBeDefault) {
      await db.account.updateMany({
        where: {
          userId: user.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    // create user account
    const account = await db.account.create({
      data: {
        ...data,
        balance: balanceFloat,
        isDefault: shouldBeDefault,
        userId: user.id,
      },
    });
    const serializedAccount = serializeTransaction(account);

    // revalidating path
    revalidatePath("/dashboard");

    return {
      success: true,
      data: serializedAccount,
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

// function to get the accounts data
export async function getUserAccounts() {
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

  const accounts = await db.account.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: {
          transactions: true,
        },
      },
    },
  });

  const serializedAccount = accounts.map(serializeTransaction);

  return serializedAccount;
}

// server action for getting dashboard data
export async function getDashbordData(params) {
  // authenticating user
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

  // get all recent user transactions
  const transactions = await db.transaction.findMany({
    where: {
      userId: user.id,
    },
    orderBy: { date: "desc" },
  });

  return transactions.map(serializeTransaction);
}
