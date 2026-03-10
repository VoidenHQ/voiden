import { Cookie, FileText, Puzzle } from "lucide-react";
import { Terminal, Plug, FileDown, Paintbrush, Braces, Code, LayoutDashboard, Eye, FilePlus2, Rocket, Wrench, Zap, Sparkles, Compass } from "lucide-react";
import changelogData from "@/data/changelog.json";

// Map icon names to Lucide icon components
const iconMap = {
  Terminal: Terminal,
  Plug: Plug,
  FileDown: FileDown,
  Paintbrush: Paintbrush,
  Braces: Braces,
  Code: Code,
  LayoutDashboard: LayoutDashboard,
  Eye: Eye,
  FilePlus2: FilePlus2,
  Rocket: Rocket,
  Wrench: Wrench,
  Zap: Zap,
  Sparkles: Sparkles,
  Compass: Compass,
  Puzzle:Puzzle,
  Cookie:Cookie
};

const ChangeLogScreen = () => {
  // Function to format date to human-readable format
  const formatDate = (dateString: string): string => {
    try {
      // Parse date in format "D/M/YYYY" or "DD/MM/YYYY"
      const parts = dateString.split('/');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const year = parseInt(parts[2], 10);

      const date = new Date(year, month, day);

      // Get day with suffix (1st, 2nd, 3rd, etc.)
      const dayWithSuffix = (d: number) => {
        if (d > 3 && d < 21) return `${d}th`;
        switch (d % 10) {
          case 1: return `${d}st`;
          case 2: return `${d}nd`;
          case 3: return `${d}rd`;
          default: return `${d}th`;
        }
      };

      // Get month name
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      return `${dayWithSuffix(day)} ${monthNames[month]} ${year}`;
    } catch (error) {
      return dateString; // Return original if parsing fails
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="min-h-screen bg-editor text-text overflow-y-auto p-4 mb-2">
      <div className="max-w-3xl mx-auto w-full pt-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
            <FileText className="w-7 h-7 text-blue-600" />
            Changelog
          </h1>
          <p className="mt-2 text-comment">
            Track the latest updates and improvements to <strong>Voiden.md</strong>
          </p>
        </div>

        {/* Changelog Items */}
        <div>
          {changelogData.map((item, index) => {
            const IconComponent = iconMap[item.icon];
            const formattedDate = formatDate(item.date);

            return (
              <div
                key={item.version}
                className={`my-6 p-6 rounded-lg shadow-sm border border-gray-700 ${item.bgColor} hover:shadow-md hover:scale-[1.01] transition-all duration-200 ${
                  index === changelogData.length - 1 ? "mb-24" : ""
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  {IconComponent && <IconComponent className={`w-6 h-6 ${item.iconColor}`} />}
                  <div>
                    <h2 className="text-xl font-semibold">{item.version}</h2>
                    <span className="text-sm text-comment">{formattedDate}</span>
                  </div>
                </div>
                {item.description && (
                  <p className="text-text mb-4 leading-relaxed">{item.description}</p>
                )}

                <div className="space-y-4">
                  {item.changes.Added?.length > 0 && (
                    <div>
                      <h3 className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                        <span className="text-lg">●</span> Added
                      </h3>
                      <ul className="space-y-2 ml-6">
                        {item.changes.Added.map((change, idx) => (
                          <li key={idx} className="text-text leading-relaxed relative before:content-['–'] before:absolute before:-left-4 before:text-comment">
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.changes.Improved?.length > 0 && (
                    <div>
                      <h3 className="text-blue-400 font-semibold mb-2 flex items-center gap-2">
                        <span className="text-lg">●</span> Improved
                      </h3>
                      <ul className="space-y-2 ml-6">
                        {item.changes.Improved.map((change, idx) => (
                          <li key={idx} className="text-text leading-relaxed relative before:content-['–'] before:absolute before:-left-4 before:text-comment">
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.changes.Changed?.length > 0 && (
                    <div>
                      <h3 className="text-yellow-400 font-semibold mb-2 flex items-center gap-2">
                        <span className="text-lg">●</span> Changed
                      </h3>
                      <ul className="space-y-2 ml-6">
                        {item.changes.Changed.map((change, idx) => (
                          <li key={idx} className="text-text leading-relaxed relative before:content-['–'] before:absolute before:-left-4 before:text-comment">
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.changes.Fixed?.length > 0 && (
                    <div>
                      <h3 className="text-red-400 font-semibold mb-2 flex items-center gap-2">
                        <span className="text-lg">●</span> Fixed
                      </h3>
                      <ul className="space-y-2 ml-6">
                        {item.changes.Fixed.map((change, idx) => (
                          <li key={idx} className="text-text leading-relaxed relative before:content-['–'] before:absolute before:-left-4 before:text-comment">
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
};

export default ChangeLogScreen;
