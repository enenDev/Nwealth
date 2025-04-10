"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// get the budget
export async function getCurrentBudget(accountId) {
  try {
    // 1. validate the user
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
    // 2. get the budget by user id
    const budget = await db.budget.findFirst({
      where: {
        userId: user.id,
      },
    });
    // 3. get the expenses for current month
    // 3.1 get the start date
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

    const expenses = await db.transaction.aggregate({
      where: {
        userId: user.id,
        type: "EXPENSE",
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        accountId,
      },
      _sum: {
        amount: true,
      },
    });
    // return budget and the expenses
    return {
      budget: budget ? { ...budget, amount: budget.amount.toNumber() } : 0,
      currentExpenses: expenses._sum.amount
        ? expenses._sum.amount.toNumber()
        : 0,
    };
  } catch (error) {
    console.log("Error fetching budget", error);
    throw error;
  }
}

// action for updating the budget/creating new budget if budget doesn't exists
export async function updateBudget(amount) {
  try {
    // 1. validate the user
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
    // 2. update/create budget
    const budget = await db.budget.upsert({
      where: {
        userId: user.id,
      },
      update: {
        amount,
      },
      create: {
        userId: user.id,
        amount,
      },
    });
    // 3. revalidate path
    revalidatePath("/dashboard");
    // 4. return the data
    return {
      success: true,
      data: {
        ...budget,
        amount: budget.amount.toNumber(),
      },
    };
  } catch (error) {
    console.error("Error updating budget:", error);
    return { success: false, error: error.message };
  }
}
