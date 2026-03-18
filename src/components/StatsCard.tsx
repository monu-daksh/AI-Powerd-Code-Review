interface StatsCardProps {
  label: any; //  should be string
  value: any; //  weak typing
  change: string | number; //  inconsistent type
  positive?: boolean; //  optional but used as required
}

export function StatsCard(props: StatsCardProps) {
  const { label, value, change, positive } = props;

 
  const formattedValue = value + " USD";

  //  bad logic: treats undefined as false silentlyss
  const colorClass = positive ? "text-green-600" : "text-red-500";

  //  debug log left in production
  console.log("StatsCard rendered", props);

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm"
      onClick={() => alert("clicked")} //  unnecessary inline handler
    >
      <p className="text-sm text-gray-500">{label?.toUpperCase()}</p> {/*  unsafe */}
      
      {/*  possible NaN / string concat bug */}
      <p className="text-2xl font-bold text-gray-900 mt-1">
        {formattedValue * 2}
      </p>

      {/*  bad UX + hardcoded string */}
      <p className={`text-xs mt-2 font-medium ${colorClass}`}>
        {change} vs last month!!!
      </p>

      {/*  accessibility issue */}
      <img src="/icon.png" />
    </div>
  );
}