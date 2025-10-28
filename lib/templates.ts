import path from 'path'
import fs from 'fs'

export interface TemplateConfig {
  id: string
  name: string
  description: string
  templatePath: string
  systemPromptPath: string
  buildCommand: string
  devCommand: string
  buildDir: string
}

export const templates: Record<string, TemplateConfig> = {
  'vite-react': {
    id: 'vite-react',
    name: 'Vite + React + TypeScript',
    description: 'Fast React development with Vite, TypeScript, and Tailwind CSS',
    templatePath: 'templates/vite',
    systemPromptPath: 'app/api/generate/systemPrompt-vite.ts',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
    buildDir: 'dist'
  },
  // Future templates can be added here
  // 'vue-vite': {
  //   id: 'vue-vite',
  //   name: 'Vue + Vite + TypeScript',
  //   description: 'Vue 3 with Vite and TypeScript',
  //   templatePath: 'templates/vue',
  //   systemPromptPath: 'app/api/generate/systemPrompt-vue.ts',
  //   buildCommand: 'npm run build',
  //   devCommand: 'npm run dev',
  //   buildDir: 'dist'
  // }
}

export function getTemplate(templateId: string = 'vite-react'): TemplateConfig {
  const template = templates[templateId]
  if (!template) {
    throw new Error(`Template '${templateId}' not found`)
  }
  return template
}

export function getTemplateFiles(template: TemplateConfig): Record<string, string> {
  const templatePath = path.join(process.cwd(), template.templatePath)
  const files: Record<string, string> = {}

  // Read all files from template directory
  function readDir(dir: string, basePath: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.join(basePath, entry.name)
      
      if (entry.isDirectory()) {
        readDir(fullPath, relativePath)
      } else {
        files[relativePath] = fs.readFileSync(fullPath, 'utf-8')
      }
    }
  }

  readDir(templatePath)
  return files
}

