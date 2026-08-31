import { groupTerminology } from "./use-group-terminology";

if (groupTerminology("SECTION").singular !== "Section") throw new Error("School terminology failed");
if (groupTerminology("BATCH").singular !== "Batch") throw new Error("Coaching terminology failed");
if (groupTerminology("CUSTOM", "Learning Group").singular !== "Learning Group") throw new Error("Custom terminology failed");
