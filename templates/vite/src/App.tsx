import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-indigo-50 to-purple-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-8">
          Generated App
        </h1>
        <button
          onClick={() => setCount(count + 1)}
          className="bg-indigo-600 text-white px-8 py-4 rounded-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 text-lg font-semibold"
        >
          Count is {count}
        </button>
      </div>
    </div>
  )
}

export default App

