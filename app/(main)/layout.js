import React from "react";

const MainLayout = ({ children }) => {
  // A wrapper for displaying the main content based on the route i.e dashboard/transactionpage/etc
  return <div className="container mx-auto my-32">{children}</div>;
};

export default MainLayout;
