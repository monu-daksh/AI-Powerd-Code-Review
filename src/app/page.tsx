import { StatsCard } from "@/components/StatsCard";
import { ActivityTable } from "@/components/ActivityTable";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Welcome back. Here&apos;s what&apos;s happening.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard label="Total Users"  value="12,430"  change="+8.2%"  positive />
          <StatsCard label="Revenue"      value="$48,295" change="+12.5%" positive />
          <StatsCard label="Open Issues"  value="34"      change="-4"     positive />
          <StatsCard label="Deployments"  value="128"     change="+3"     positive />
        </div>

        <ActivityTable />
      </div>
    </div>
  );
}
