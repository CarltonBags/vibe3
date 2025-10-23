import { Suspense } from 'react'
import { use } from 'react'
import TextContent from './TextContent'

interface TextPageProps {
  params: Promise<{
    id: string
  }>
}

export default function TextPage({ params }: TextPageProps) {
  const resolvedParams = use(params)
  
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <Suspense fallback={
          <div className="input-container p-8">
            <div className="animate-pulse bg-gray-700/50 h-6 rounded w-3/4"></div>
          </div>
        }>
          <TextContent id={resolvedParams.id} />
        </Suspense>
      </div>
    </main>
  )
}
