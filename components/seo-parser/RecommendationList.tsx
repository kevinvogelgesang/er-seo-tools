export function RecommendationList({ recommendations }: { recommendations: string[] }) {
  if (recommendations.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
      <h2 className="text-base font-semibold text-[#1c2d4a] mb-4">Recommendations</h2>
      <ol className="space-y-3">
        {recommendations.map((rec, i) => {
          const isCritical = rec.startsWith('CRITICAL:');
          return (
            <li
              key={i}
              className={`flex items-start space-x-3 p-3 rounded-lg ${
                isCritical ? 'bg-red-50' : 'bg-gray-50'
              }`}
            >
              <span
                className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white ${
                  isCritical ? 'bg-red-600' : 'bg-[#1c2d4a]'
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-sm ${isCritical ? 'text-red-800' : 'text-gray-700'}`}>{rec}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
