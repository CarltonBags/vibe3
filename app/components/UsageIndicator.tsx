'use client'

import { useUserUsage } from '@/lib/hooks/useUserUsage'

export default function UsageIndicator() {
  const { usage, loading } = useUserUsage()

  // Show loading skeleton
  if (loading) {
    return (
      <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg px-4 py-2.5 shadow-xl">
        <div className="flex items-center gap-4 animate-pulse">
          <div className="h-10 w-20 bg-zinc-800 rounded"></div>
          <div className="h-12 w-px bg-zinc-700"></div>
          <div className="h-10 w-32 bg-zinc-800 rounded"></div>
          <div className="h-12 w-px bg-zinc-700"></div>
          <div className="h-10 w-24 bg-zinc-800 rounded"></div>
        </div>
      </div>
    )
  }

  if (!usage) {
    return null
  }

  const generationsPercent = (usage.generationsUsed / usage.generationsLimit) * 100
  const isLow = generationsPercent >= 80
  const isEmpty = usage.generationsUsed >= usage.generationsLimit

  return (
    <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg px-4 py-2.5 shadow-xl">
      <div className="flex items-center gap-4">
        {/* Tier Badge */}
        <div className="flex flex-col items-center">
          <p className="text-[10px] text-gray-400 uppercase mb-1">Plan</p>
          <span 
            className="text-xs font-bold px-3 py-1 rounded-md whitespace-nowrap"
            style={{
              backgroundImage: 'url(/vibe_gradient.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <span className="text-white drop-shadow-lg">{usage.tierDisplayName}</span>
          </span>
        </div>

        {/* Divider */}
        <div className="h-12 w-px bg-zinc-700"></div>

        {/* Generations */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-[10px] text-gray-400 uppercase">Generations</p>
          </div>
          <div className="flex items-center gap-2">
            <p className={`text-sm font-bold ${isEmpty ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-white'}`}>
              {Math.max(0, usage.generationsLimit - usage.generationsUsed)} / {usage.generationsLimit}
            </p>
            <div className="w-16 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
              <div 
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, generationsPercent)}%`,
                  backgroundColor: isEmpty ? '#ef4444' : isLow ? '#eab308' : '#a855f7'
                }}
              />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-12 w-px bg-zinc-700"></div>

        {/* Tokens */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-[10px] text-gray-400 uppercase">Tokens Used</p>
          </div>
          <p className="text-sm font-bold text-blue-400">
            {usage.tokensUsed.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}

