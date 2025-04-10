"use client";

import { scanReceipt } from "@/actions/transaction";
import { Button } from "@/components/ui/button";
import useFetch from "@/hooks/use-fetch";
import { Camera, Loader, Loader2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const ReceiptScanner = ({ onScanComplete }) => {
  const fileInputRef = useRef();
  //   using useFetch
  const {
    loading: scanReceiptLoading,
    fn: scanReceiptFn,
    data: scanReceiptData,
  } = useFetch(scanReceipt);

  //   local state for storing file name
  const [fileName, setFileName] = useState("");

  //   handler for scanning the uploaded file
  const handleScanReceipt = async (file) => {
    // check if file size is more than 5mb then show error
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size should be less than 5mb");
      return;
    }
    await scanReceiptFn(file);
  };

  //   useEffect to scan receipt on success
  useEffect(() => {
    if (scanReceiptData && !scanReceiptLoading) {
      onScanComplete(scanReceiptData);
      toast.success("Scanned receipt successfully");
    }
  }, [scanReceiptLoading, scanReceiptData]);
  return (
    <div>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setFileName(file.name);
          if (file) handleScanReceipt(file);
        }}
      />
      <Button
        type="button"
        className="w-full h-10 bg-gradient-to-br from-orange-500 via-pink-500 to-purple-500 animate-gradient hover:opacity-90 transition-opacity text-white hover:text-white"
        // using the fileInputRef to enable click on this button, but to perform action of input
        onClick={() => fileInputRef.current?.click()}
        disabled={scanReceiptLoading}
      >
        {scanReceiptLoading ? (
          <>
            <Loader2 className="mr-2 animate-spin" />
            <span>Scanning receipt ...</span>
          </>
        ) : (
          <>
            <Camera className="mr-2" />
            Scan Receipt with AI {fileName ? `(${fileName})` : ""}
          </>
        )}
      </Button>
    </div>
  );
};

export default ReceiptScanner;
