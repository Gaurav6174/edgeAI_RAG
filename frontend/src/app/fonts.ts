import { Inter, EB_Garamond } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  display: "swap",
  weight: ["400"], // EB Garamond doesn't have 300, 400 is fine as substitute
  variable: "--font-eb-garamond",
});
