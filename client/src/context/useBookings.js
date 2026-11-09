import { useContext } from "react";
import { BookingsContext } from "./BookingsContextValue.js";

export function useBookings() {
  const context = useContext(BookingsContext);
  if (!context) {
    throw new Error("useBookings must be used within BookingsProvider");
  }
  return context;
}
