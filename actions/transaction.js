"use server";
import aj from "@/lib/arcjet";
import { db } from "@/lib/prisma";
import { request } from "@arcjet/next";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { revalidatePath } from "next/cache";

// using google gen ai
const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// handler for serializing amount
const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

// server action to create a new transaction
export async function createTransaction(data) {
  try {
    // checking for the user first
    const { userId } = await auth();
    // check if user exists or not in clerk
    if (!userId) throw new Error("Unauthorized");

    // archJet to use rate limiter
    // 1. get request data for ArcJet
    const req = await request();

    // 2.  check request limit
    const decision = await aj.protect(req, {
      userId,
      requested: 1, // specify how many tokens to consume
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        // to ge the remaining requests and the reset time
        const { remaining, reset } = decision.reason;
        console.error({
          code: "RAE_LIMIT_EXCEEDED",
          details: {
            remaining,
            resetInSeconds: reset,
          },
        });
        // shows this error when reason is max capacity reached
        throw new Error("Too many requests, please try again later");
      }
      // shows this error when reason is something else
      throw new Error("Request blocked");
    }

    // similarly we have to check if user exists in database
    const user = await db.user.findUnique({
      where: {
        clerkUserId: userId, // clerkUserId is col name in db of user table
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // get the account details
    const account = await db.account.findUnique({
      where: {
        id: data.accountId,
        userId: user.id,
      },
    });

    if (!account) {
      throw new Error("Account not found");
    }
    console.log("account details", account);

    // get the balance change
    const balanceChange = data.type === "EXPENSE" ? -data.amount : data.amount;
    const newBalance = account.balance.toNumber() + balanceChange;

    /**
     * creating a prisma transaction to
     * 1. create a  new transaction
     * 2. update the account balance
     * */
    const transaction = await db.$transaction(async (tx) => {
      // creating new transaction
      const newTransaction = await tx.transaction.create({
        data: {
          ...data,
          userId: user.id,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
              : null,
        },
      });

      //   udpate the account balance
      await tx.account.update({
        where: { id: data.accountId },
        data: {
          balance: newBalance,
        },
      });

      return newTransaction;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${transaction.accountId}`);

    return {
      success: true,
      data: serializeAmount(transaction),
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

// server action to scan receipt
export async function scanReceipt(file) {
  try {
    const model = genAi.getGenerativeModel({ model: "gemini-1.5-flash" });

    // convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();

    // convert array buffer to base 64
    const base64String = Buffer.from(arrayBuffer).toString("base64");

    // defining prompt for the api
    const prompt = ` Total amount (just the number)
      - Date (in ISO format)
      - Description or items purchased (brief summary)
      - Merchant/store name
      - Suggested category (one of: housing,transportation,groceries,utilities,entertainment,Food,shopping,healthcare,education,personal,travel,insurance,gifts,bills,other-expense )
      
      Only respond with valid JSON in this exact format:
      {
        "amount": number,
        "date": "ISO date string",
        "description": "string",
        "merchantName": "string",
        "category": "string"
      }

      If its not a recipt, return an empty object`;

    // getting content from genAI mode
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      },
      prompt,
    ]);

    const response = await result.response; //adding await to make sure accessing result only once it's available
    const text = response.text();
    // as the text starts and ends with something like this "/```` JSON actual text ````JSON", to remove this we are cleaning the text using regex
    const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

    try {
      const data = JSON.parse(cleanedText);
      return {
        amount: parseFloat(data.amount),
        date: data.date,
        description: data.description,
        category: data.category,
        merchantName: data.merchantName,
      };
    } catch (parseError) {
      console.log("Error parsing JSON response:", parseError);
      throw new Error("Invalid response format from Gemini");
    }
  } catch (error) {
    console.log("Error scanning receipt:", error.message);
    throw new Error("Failed to scan the receipt ");
  }
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

  return date;
}

// get the transaction details on edit
export async function getTransaction(id) {
  // validate user
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  // get the transaction detail

  const transaction = await db.transaction.findUnique({
    where: {
      id,
      userId: user.id,
    },
  });

  if (!transaction) throw new Error("Transaction not found");

  return serializeAmount(transaction);
}

// update the transaction on submit of edit
export async function updateTransaction(id, data) {
  try {
    // validate user
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    // get the actual transaction to calculate the balance change
    const originalTransaction = await db.transaction.findUnique({
      where: {
        id,
        userId: user.id,
      },
      include: {
        account: true,
      },
    });

    if (!originalTransaction) throw new Error("Transaction not found");

    // calculate old balance changes
    const oldBalanceChange =
      originalTransaction.type === "EXPENSE"
        ? -originalTransaction.amount.toNumber()
        : originalTransaction.amount.toNumber();

    // calculate new balance change
    const newBalanceChange =
      data.type === "EXPENSE" ? -data.amount : data.amount;

    //   calculate net balance change
    const netBalanceChange = newBalanceChange - oldBalanceChange;

    // update the transaction and update balance
    const transaction = await db.$transaction(async (tx) => {
      // update the transaction details
      const updatedTransaction = await tx.transaction.update({
        where: {
          id,
          userId: user.id,
        },
        data: {
          ...data,
          nextRecurringDate:
            data.isRecurring && data.recurringInterval
              ? calculateNextRecurringDate(data.date, data.recurringInterval)
              : null,
        },
      });

      //   update the balance
      await tx.account.update({
        where: {
          id: data.accountId,
        },
        data: {
          balance: {
            increment: netBalanceChange,
          },
        },
      });

      return updatedTransaction;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { success: true, data: serializeAmount(transaction) };
  } catch (error) {
    throw new Error(error.message);
  }
}
