'use client'

import { useState, useEffect } from 'react'

interface Page {
  id: string
  name: string
  path: string
  description: string
  category: string
  recommended: boolean
  complexity: number
}

interface StyleOption {
  id: string
  name: string
  description: string
  preview: string
}

interface ColorPalette {
  id: string
  name: string
  colors: string[]
}

interface ProjectPlannerProps {
  prompt: string
  onComplete: (data: {
    prompt: string
    selectedPages: Page[]
    selectedStyle: string
    colors: string[]
    logo: string | null
    additionalInfo: string
    planData: any
  }) => void
  onCancel: () => void
}

type Step = 'prompt' | 'pages' | 'style' | 'colors' | 'logo' | 'info' | 'building'

export default function ProjectPlanner({ prompt: initialPrompt, onComplete, onCancel }: ProjectPlannerProps) {
  const [step, setStep] = useState<Step>('pages')
  const [prompt] = useState(initialPrompt)
  const [suggestedPages, setSuggestedPages] = useState<Page[]>([])
  const [selectedPages, setSelectedPages] = useState<Page[]>([])
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [selectedStyle, setSelectedStyle] = useState<string>('')
  const [colorPalettes, setColorPalettes] = useState<ColorPalette[]>([])
  const [customColors, setCustomColors] = useState<string[]>([])
  const [selectedPalette, setSelectedPalette] = useState<string>('')
  const [hexInput, setHexInput] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [planData, setPlanData] = useState<any>(null)

  // Load page suggestions on mount
  useEffect(() => {
    const loadPageSuggestions = async () => {
      if (!prompt.trim()) {
        setError('No prompt provided')
        return
      }

      setLoading(true)
      setError('')

      try {
        const response = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step: 'suggest_pages',
            userPrompt: prompt,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to get page suggestions')
        }

        const data = await response.json()
        setSuggestedPages(data.suggestedPages || [])
        // Auto-select recommended pages
        const recommended = data.suggestedPages?.filter((p: Page) => p.recommended) || []
        setSelectedPages(recommended)
      } catch (err: any) {
        setError(err.message || 'Failed to get page suggestions')
      } finally {
        setLoading(false)
      }
    }

    loadPageSuggestions()
  }, [prompt])

  // Step 2: Get style options
  const handlePagesNext = async () => {
    if (selectedPages.length === 0) {
      setError('Please select at least one page')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'select_style',
          selectedPages,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get style options')
      }

      const data = await response.json()
      setStyleOptions(data.styleOptions || [])
      setStep('style')
    } catch (err: any) {
      setError(err.message || 'Failed to get style options')
    } finally {
      setLoading(false)
    }
  }

  // Step 3: Get color options
  const handleStyleNext = async () => {
    if (!selectedStyle) {
      setError('Please select a style')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'select_colors',
          selectedPages,
          selectedStyle,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get color options')
      }

      const data = await response.json()
      setColorPalettes(data.colorPalettes || [])
      setStep('colors')
    } catch (err: any) {
      setError(err.message || 'Failed to get color options')
    } finally {
      setLoading(false)
    }
  }

  // Add custom color
  const handleAddColor = () => {
    const hex = hexInput.trim().replace('#', '')
    if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
      setError('Invalid hex color. Please use format: #RRGGBB')
      return
    }

    const color = `#${hex}`
    if (!customColors.includes(color)) {
      setCustomColors([...customColors, color])
    }
    setHexInput('')
    setError('')
  }

  // Select palette
  const handleSelectPalette = (paletteId: string) => {
    setSelectedPalette(paletteId)
    const palette = colorPalettes.find(p => p.id === paletteId)
    if (palette) {
      setCustomColors([...palette.colors])
    }
  }

  // Step 4: Logo upload
  const handleColorsNext = () => {
    if (customColors.length === 0 && !selectedPalette) {
      setError('Please add colors or select a palette')
      return
    }

    setStep('logo')
    setError('')
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      setLogo(result)
    }
    reader.readAsDataURL(file)
  }

  // Step 5: Additional info
  const handleLogoNext = () => {
    setStep('info')
    setError('')
  }

  // Step 6: Generate final plan
  const handleInfoNext = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'generate_plan',
          userPrompt: prompt,
          selectedPages,
          selectedStyle,
          colors: customColors.length > 0 ? customColors : (selectedPalette ? colorPalettes.find(p => p.id === selectedPalette)?.colors || [] : []),
          logo,
          additionalInfo,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate plan')
      }

      const data = await response.json()
      setPlanData(data.plan)
      setStep('building')
      
      // Complete the planning process
      onComplete({
        prompt,
        selectedPages,
        selectedStyle,
        colors: customColors.length > 0 ? customColors : (selectedPalette ? colorPalettes.find(p => p.id === selectedPalette)?.colors || [] : []),
        logo,
        additionalInfo,
        planData: data.plan,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to generate plan')
    } finally {
      setLoading(false)
    }
  }

  const togglePage = (page: Page) => {
    if (selectedPages.find(p => p.id === page.id)) {
      setSelectedPages(selectedPages.filter(p => p.id !== page.id))
    } else {
      setSelectedPages([...selectedPages, page])
    }
  }

  const removeColor = (color: string) => {
    setCustomColors(customColors.filter(c => c !== color))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-4">Plan Your Project</h2>

          {/* Step 1: Page Selection */}
          {step === 'pages' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Select Pages to Build</label>
              <div className="space-y-2">
                {suggestedPages.map((page) => (
                  <label
                    key={page.id}
                    className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPages.some(p => p.id === page.id)}
                      onChange={() => togglePage(page)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{page.name}</div>
                      <div className="text-sm text-gray-500">{page.description}</div>
                      {page.recommended && (
                        <span className="text-xs text-blue-500">Recommended</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              {loading && <p className="text-blue-500 text-sm">Loading page suggestions...</p>}
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePagesNext}
                  disabled={loading || suggestedPages.length === 0}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Next'}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Style Selection */}
          {step === 'style' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Select Style</label>
              <div className="grid grid-cols-1 gap-3">
                {styleOptions.map((style) => (
                  <label
                    key={style.id}
                    className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:border-blue-500"
                    style={{
                      borderColor: selectedStyle === style.id ? '#3B82F6' : '#E5E7EB',
                    }}
                  >
                    <input
                      type="radio"
                      name="style"
                      value={style.id}
                      checked={selectedStyle === style.id}
                      onChange={() => setSelectedStyle(style.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{style.name}</div>
                      <div className="text-sm text-gray-500">{style.description}</div>
                      <div className="text-xs text-gray-400 mt-1">{style.preview}</div>
                    </div>
                  </label>
                ))}
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('pages')}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleStyleNext}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Next'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Color Selection */}
          {step === 'colors' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Select Colors</label>
              
              {/* Custom Color Input */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Add Custom Colors</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hexInput}
                    onChange={(e) => setHexInput(e.target.value)}
                    placeholder="#RRGGBB"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <button
                    onClick={handleAddColor}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Add
                  </button>
                </div>
                {hexInput && (
                  <div
                    className="w-12 h-12 rounded border border-gray-300"
                    style={{ backgroundColor: hexInput.startsWith('#') ? hexInput : `#${hexInput}` }}
                  />
                )}
              </div>

              {/* Selected Colors */}
              {customColors.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Selected Colors</label>
                  <div className="flex flex-wrap gap-2">
                    {customColors.map((color, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 border border-gray-300 rounded-lg"
                      >
                        <div
                          className="w-8 h-8 rounded border border-gray-300"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm">{color}</span>
                        <button
                          onClick={() => removeColor(color)}
                          className="text-red-500 hover:text-red-700"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Color Palettes */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Or Choose a Palette</label>
                <div className="grid grid-cols-2 gap-3">
                  {colorPalettes.map((palette) => (
                    <button
                      key={palette.id}
                      onClick={() => handleSelectPalette(palette.id)}
                      className="p-3 border-2 rounded-lg hover:border-blue-500 text-left"
                      style={{
                        borderColor: selectedPalette === palette.id ? '#3B82F6' : '#E5E7EB',
                      }}
                    >
                      <div className="font-medium text-sm mb-2">{palette.name}</div>
                      <div className="flex gap-1">
                        {palette.colors.map((color, index) => (
                          <div
                            key={index}
                            className="w-8 h-8 rounded border border-gray-300"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('style')}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleColorsNext}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Logo Upload */}
          {step === 'logo' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Upload Logo (Optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              {logo && (
                <div className="mt-4">
                  <img src={logo} alt="Logo preview" className="max-w-xs h-20 object-contain" />
                </div>
              )}
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('colors')}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleLogoNext}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 6: Additional Info */}
          {step === 'info' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Additional Information (Optional)</label>
              <textarea
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder="Any additional details about your website?"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={4}
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('logo')}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Back
                </button>
                <button
                  onClick={handleInfoNext}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? 'Generating Plan...' : 'Build Project'}
                </button>
              </div>
            </div>
          )}

          {/* Step 7: Building */}
          {step === 'building' && (
            <div className="space-y-4">
              <p className="text-center">Plan generated! Building your project...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

