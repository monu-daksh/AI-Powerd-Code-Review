interface StatsCardProps {
  label: string;
  value: string;
  change: string;
  positive: boolean;
}

export function StatsCard({ label, value, change, positive }: StatsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      <p className={`text-xs mt-2 font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
        {change} vs last month
      </p>
    </div>
  );
}
