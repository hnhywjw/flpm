import { listStock, listStockMoves, listTickets, listWarranties, getStockAlerts } from "@/lib/queries";
import { withAuth } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async () => ({
    stock: listStock(),
    moves: listStockMoves(),
    alerts: getStockAlerts(),
    tickets: listTickets(),
    warranties: listWarranties(),
  }));
}
