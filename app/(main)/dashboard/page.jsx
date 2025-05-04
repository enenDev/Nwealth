import { getDashbordData, getUserAccounts } from "@/actions/dashboard";
import CreateAccountDrawer from "@/components/create-account-drawer";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import React, { Suspense } from "react";
import AccountCardComponent from "./_components/account-card-component";
import { getCurrentBudget } from "@/actions/budget";
import BudgetProgress from "./_components/budget-progress";
import DashboardOverview from "./_components/transaction-overviews";

async function DashboardPage() {
  // getting tha accounts data
  const accounts = await getUserAccounts();

  // getting the default account
  const defaultAccount = accounts?.find((account) => account.isDefault);

  // getting the budget of current default account
  let budgetData = null;
  if (defaultAccount) {
    budgetData = await getCurrentBudget(defaultAccount.id);
  }

  // getting the all recent transactions data for the overview
  const transactions = await getDashbordData();
  console.log("logging to check");

  return (
    <div className="space-y-8">
      {/* Budget progress */}
      {defaultAccount && (
        <BudgetProgress
          initialBudget={budgetData.budget}
          currentExpenses={budgetData.currentExpenses || 0}
        />
      )}
      {/* Overview */}
      <Suspense fallback={"Loading Overview"}>
        <DashboardOverview
          accounts={accounts}
          transactions={transactions || []}
        />
      </Suspense>

      {/* Accounts grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CreateAccountDrawer>
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-dashed">
            <CardContent className="flex flex-col items-center justify-center text-muted-foreground h-full pt-5">
              <Plus className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">Create New Account</p>
            </CardContent>
          </Card>
        </CreateAccountDrawer>

        {/* renderring user accounts */}
        {accounts.length > 0 &&
          accounts.map((account) => {
            return <AccountCardComponent key={account.id} account={account} />;
          })}
      </div>
    </div>
  );
}

export default DashboardPage;
