import { useCallback, useMemo, useState } from "react";

function isoDateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

import { LEAD_DEFAULT_STATUS } from "./bookingConstants.js";
import { BookingsContext } from "./BookingsContextValue.js";

function buildInitialVisits() {
  return [
    {
      id: "V-1001",
      leadId: "4",
      buyer: "Vikram Patel",
      project: "Skyline Residences",
      visitDate: isoDateOffset(0),
      slot: "4:30 PM",
      executive: "Arjun Nair",
      status: "Scheduled",
    },
    {
      id: "V-1002",
      leadId: "6",
      buyer: "Meera Iyer",
      project: "Green Valley Phase 2",
      visitDate: isoDateOffset(0),
      slot: "11:30 AM",
      executive: "Sneha Rao",
      status: "Scheduled",
    },
    {
      id: "V-1003",
      leadId: "3",
      buyer: "Ananya Desai",
      project: "Riverfront Heights",
      visitDate: isoDateOffset(1),
      slot: "2:00 PM",
      executive: "Karan Mehta",
      status: "Scheduled",
    },
    {
      id: "V-1004",
      leadId: "7",
      buyer: "Dhruv Khanna",
      project: "Riverfront Heights",
      visitDate: isoDateOffset(2),
      slot: "10:00 AM",
      executive: "Arjun Nair",
      status: "Scheduled",
    },
    {
      id: "V-1005",
      leadId: "5",
      buyer: "Kavita Joshi",
      project: "Palm Grove Villas",
      visitDate: isoDateOffset(3),
      slot: "3:30 PM",
      executive: "Sneha Rao",
      status: "Scheduled",
    },
    {
      id: "V-1006",
      leadId: "8",
      buyer: "Neha Gupta",
      project: "Palm Grove Villas",
      visitDate: isoDateOffset(-1),
      slot: "4:30 PM",
      executive: "Karan Mehta",
      status: "Completed",
    },
    {
      id: "V-1007",
      leadId: "2",
      buyer: "Rahul Shah",
      project: "Green Valley Phase 2",
      visitDate: isoDateOffset(-2),
      slot: "11:30 AM",
      executive: "Arjun Nair",
      status: "Completed",
    },
    {
      id: "V-1008",
      leadId: "9",
      buyer: "Sanjay Reddy",
      project: "Skyline Residences",
      visitDate: isoDateOffset(-3),
      slot: "2:00 PM",
      executive: "Karan Mehta",
      status: "Cancelled",
    },
    {
      id: "V-1009",
      leadId: "10",
      buyer: "Isha Kapoor",
      project: "Riverfront Heights",
      visitDate: isoDateOffset(5),
      slot: "10:00 AM",
      executive: "Sneha Rao",
      status: "Scheduled",
    },
    {
      id: "V-1010",
      leadId: "1",
      buyer: "Priya Mehta",
      project: "Skyline Residences",
      visitDate: isoDateOffset(-5),
      slot: "3:30 PM",
      executive: "Sneha Rao",
      status: "Cancelled",
    },
  ];
}

export function BookingsProvider({ children }) {
  const [visits, setVisits] = useState(buildInitialVisits);
  const [leadStatusOverrides, setLeadStatusOverrides] = useState({});

  const bookedSlotKeys = useMemo(
    () =>
      visits
        .filter((v) => v.status === "Scheduled")
        .map((v) => `${v.visitDate}|${v.slot}`),
    [visits],
  );

  const resolveLeadStatus = useCallback(
    (leadId, baseStatus) => {
      if (leadStatusOverrides[leadId] !== undefined) {
        return leadStatusOverrides[leadId];
      }
      const hasScheduled = visits.some(
        (v) => v.leadId === leadId && v.status === "Scheduled",
      );
      if (hasScheduled) return "Visit booked";
      return baseStatus;
    },
    [visits, leadStatusOverrides],
  );

  const getLeadVisitDisplay = useCallback(
    (leadId) => {
      const forLead = visits.filter(
        (v) => v.leadId === leadId && v.status !== "Cancelled",
      );
      const scheduled = forLead.find((v) => v.status === "Scheduled");
      if (scheduled) return scheduled;
      return forLead.sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0];
    },
    [visits],
  );

  const createBookingFromLead = useCallback((leadId, booking) => {
    const visit = {
      id: booking.id,
      leadId,
      buyer: booking.buyerName,
      project: booking.project,
      visitDate: booking.visitDate,
      slot: booking.slot,
      executive: booking.executive,
      status: "Scheduled",
    };
    setVisits((prev) => [visit, ...prev]);
    setLeadStatusOverrides((prev) => ({ ...prev, [leadId]: "Visit booked" }));
    return visit;
  }, []);

  const updateVisitStatus = useCallback((visitId, nextStatus) => {
    let leadToRevert = null;

    setVisits((prev) => {
      const target = prev.find((v) => v.id === visitId);
      if (!target || target.status !== "Scheduled") return prev;
      if (nextStatus !== "Completed" && nextStatus !== "Cancelled") return prev;

      const updated = prev.map((v) =>
        v.id === visitId ? { ...v, status: nextStatus } : v,
      );

      if (nextStatus === "Cancelled") {
        const leadId = target.leadId;
        const stillScheduled = updated.some(
          (v) => v.leadId === leadId && v.status === "Scheduled",
        );
        if (!stillScheduled) {
          leadToRevert = leadId;
        }
      }

      return updated;
    });

    if (leadToRevert) {
      setLeadStatusOverrides((overrides) => ({
        ...overrides,
        [leadToRevert]: LEAD_DEFAULT_STATUS[leadToRevert] ?? "Qualified",
      }));
    }
  }, []);

  // Fix: updateVisitStatus shouldn't call setMenuOpenId - remove that typo

  const value = useMemo(
    () => ({
      visits,
      bookedSlotKeys,
      createBookingFromLead,
      updateVisitStatus,
      resolveLeadStatus,
      getLeadVisitDisplay,
    }),
    [
      visits,
      bookedSlotKeys,
      createBookingFromLead,
      updateVisitStatus,
      resolveLeadStatus,
      getLeadVisitDisplay,
    ],
  );

  return (
    <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>
  );
}

