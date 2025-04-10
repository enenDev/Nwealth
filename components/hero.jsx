"use client";

import Link from "next/link";
import React, { useEffect, useRef } from "react";
import { Button } from "./ui/button";
import Image from "next/image";

const HeroSection = () => {
  // hook for image ref
  const imageRef = useRef();

  //   use effect to add the tilt effect of image on scroll
  useEffect(() => {
    const imageElemnent = imageRef.current;

    const handleScroll = () => {
      // get the scroll position and set a scroll threshold
      const scrollPosition = window.scrollY;
      const scrollThreshold = 200;

      // check if the scroll position is greater than the threshold
      if (scrollPosition > scrollThreshold) {
        // add the tilt class to the image element
        imageElemnent.classList.add("scrolled");
      } else {
        // remove the tilt class from the image element
        imageElemnent.classList.remove("scrolled");
      }
    };

    // adding the event listener to scroll action
    window.addEventListener("scroll", handleScroll);

    // remove the event listener on unmount
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div className="pb-20 px-4">
      {/* main title content */}
      <div className="container mx-auto text-center">
        <h1 className="text-5xl md:text-8xl lg:text-[105px] gradient-title">
          Manage your finances <br /> with Intelligence
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          An AI powered financial management platform that helps you track,
          analyze and optimize your spendings with real time insights
        </p>
      </div>
      {/* buttons div */}
      <div className="flex justify-center space-x-4">
        <Link href={"/dashboard"}>
          <Button size="lg" className="px-8">
            Get started
          </Button>
        </Link>
        <Link href={"/youtube.com"}>
          <Button size="lg" className="px-8" variant="outline">
            Tutorial
          </Button>
        </Link>
      </div>

      {/* banner div */}
      <div className="hero-image-wrapper">
        <div ref={imageRef} className="hero-image">
          <Image
            src={"/banner.jpeg"}
            width={1280}
            height={720}
            alt="Dashboard banner"
            className="rounded-lg shadow-2xl border mx-auto"
            priority
          />
        </div>
      </div>
    </div>
  );
};

export default HeroSection;
