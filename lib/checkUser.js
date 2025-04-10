import { currentUser, User } from "@clerk/nextjs/server";
import { db } from "./prisma";

export const checkUser = async () => {
  const user = await currentUser();

  // check if user exists in the clerk
  if (!user) {
    return null;
  }

  // check if user exists in DB
  try {
    // getting user details from DB
    const loggedInUser = await db.user.findUnique({
      where: {
        // clerkUserId is column name in users table
        clerkUserId: user.id,
      },
    });

    // if we have user in DB return it
    if (loggedInUser) {
      return loggedInUser;
    }

    // if user doesn't exists, create new user
    const name = `${user.firstName} ${user.lastName}`;

    const newUser = await db.user.create({
      data: {
        clerkUserId: user.id,
        name,
        imageUrl: user.imageUrl,
        email: user.emailAddresses[0].emailAddress,
      },
    });

    return newUser;
  } catch (error) {
    console.log("error", error.message);
  }
};
