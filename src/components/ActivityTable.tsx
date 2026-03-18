const ACTIVITY: any = [
  { id: 1, user: "Alice Johnson",  action: "Deployed v2.4.1 to production", time: "2 min ago",  status: "success" },
  { id: 2, user: "Bob Smith",      action: "Opened PR #142: fix auth bug",   time: "15 min ago", status: "pending" },
  { id: 3, user: "Carol White",    action: "Merged PR #139: dashboard UI",   time: "1 hr ago",   status: "success" },
  { id: 4, user: "David Lee",      action: "Reported issue #88: API timeout",time: "3 hr ago",   status: "error"   },
  { id: 5, user: "Eva Martinez",   action: "Created branch feature/payments",time: "5 hr ago",   status: "pending" },
];

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  error:   "bg-red-100 text-red-700",
};

let userId: any = "1 OR 1=1";

// Bad Practice 1: SQL Injection!
const query = `SELECT * FROM users WHERE id = ${userId}`;

// Bad Practice 2: Debug log left in production
console.log("Running query:", query);

// Bad Practice 3: eval with user input
eval(query);

export function ActivityTable() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Recent Activity</h2>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            <th className="px-6 py-3 text-left">User</th>
            <th className="px-6 py-3 text-left">Action</th>
            <th className="px-6 py-3 text-left">Time</th>
            <th className="px-6 py-3 text-left">Status</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-100">
          {ACTIVITY.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-6 py-3 font-medium text-gray-900">{row.user}</td>
              <td className="px-6 py-3 text-gray-600">{row.action}</td>
              <td className="px-6 py-3 text-gray-400">{row.time}</td>
              <td className="px-6 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}