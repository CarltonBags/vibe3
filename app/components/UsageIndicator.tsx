'use client'

import { useUserUsage } from '@/lib/hooks/useUserUsage'

export default function UsageIndicator() {
  const { usage, loading } = useUserUsage()

  if (loading || !usage) {
    return null
  }

  const generationsPercent = (usage.generationsUsed / usage.generationsLimit) * 100
  const isLow = generationsPercent >= 80
  const isEmpty = usage.generationsUsed >= usage.generationsLimit

  return (
    <div className="fixed top-4 left-4 z-40">
      <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg px-4 py-2 shadow-xl">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="relative">
            <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {isEmpty && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
            )}
          </div>

          {/* Text */}
          <div>
            <p className="text-xs text-gray-400">Generations</p>
            <p className={`text-sm font-bold ${isEmpty ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-white'}`}>
              {Math.max(0, usage.generationsLimit - usage.generationsUsed)} / {usage.generationsLimit} left
            </p>
          </div>

          {/* Progress indicator */}
          <div className="ml-2">
            <div className="w-12 h-12 relative">
              <svg className="transform -rotate-90" width="48" height="48">
                {/* Background circle */}
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke="#3f3f46"
                  strokeWidth="4"
                />
                {/* Progress circle */}
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  fill="none"
                  stroke={isEmpty ? '#ef4444' : isLow ? '#eab308' : '#a855f7'}
                  strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 20}`}
                  strokeDashoffset={`${2 * Math.PI * 20 * (1 - generationsPercent / 100)}`}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                {Math.round(100 - generationsPercent)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

