"use client";

import { updateBudget } from "@/actions/budget";
import useFetch from "@/hooks/use-fetch";
import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, Pencil, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const BudgetProgress = ({ initialBudget, currentExpenses }) => {
  // local state for isEditing
  const [isEditing, setIsEditing] = useState(false);
  // local state for setting new budget
  const [newBudget, setNewBudget] = useState(
    initialBudget?.amount?.toString() || ""
  );

  console.log("current", currentExpenses);

  // using the useFetch hook
  const {
    data: updatedBudget,
    error,
    fn: updateBudgetFn,
    loading: isLoading,
  } = useFetch(updateBudget);

  //   calculating the budge percentage
  const percentUsed = initialBudget
    ? (currentExpenses / initialBudget.amount) * 100 > 100
      ? 100
      : (currentExpenses / initialBudget.amount) * 100
    : 0;

  // handler for updating budget
  const handleUpdateBudget = async () => {
    const amount = parseFloat(newBudget);

    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    await updateBudgetFn(amount).then(() => setIsEditing(false));
  };

  // handler for cancel
  const handleCancel = () => {
    // ressetting it to current budget
    setNewBudget(initialBudget?.amount?.toString() || "");
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex-1">
          <CardTitle className="text-sm font-medium">Card Title</CardTitle>
          <div className="flex item-center gap-2 mt-1">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                  className="w-32"
                  autoFocus
                  placeholder="Enter amount"
                  disabled={isLoading}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleUpdateBudget}
                  disabled={isLoading}
                >
                  <Check className="h-4 w-4 text-green-500" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCancel}
                  disabled={isLoading}
                >
                  <X className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ) : (
              <>
                <CardDescription>
                  {initialBudget
                    ? `$${currentExpenses?.toFixed(
                        2
                      )} of ${initialBudget.amount.toFixed(2)} spent`
                    : "No budget set"}
                </CardDescription>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsEditing(true)}
                  className="h-6 w-6"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {initialBudget && (
          <div className="space-y-2">
            <Progress
              value={percentUsed}
              extraStyles={`${
                percentUsed >= 90
                  ? "bg-red-500"
                  : percentUsed >= 75
                  ? "bg-yellow-500"
                  : "bg-blue-500"
              }`}
            />
            <p className="text-xs text-muted-foreground text-right">
              {percentUsed.toFixed(1)}% used
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BudgetProgress;
