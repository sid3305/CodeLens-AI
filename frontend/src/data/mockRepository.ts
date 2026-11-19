import type { Repository, RepositoryFile } from '../types'

export const mockRepository: Repository = {
  id: 'repo-001',
  name: 'CodeLens-Demo',
  source: 'Local ZIP upload',
  branch: 'main',
  status: 'ready',
}

export const mockFiles: RepositoryFile[] = [
  {
    name: 'backend',
    path: 'backend',
    type: 'folder',
    children: [
      {
        name: 'main.py',
        path: 'backend/main.py',
        type: 'file',
        language: 'Python',
      },
      {
        name: 'auth.py',
        path: 'backend/auth.py',
        type: 'file',
        language: 'Python',
      },
      {
        name: 'database.py',
        path: 'backend/database.py',
        type: 'file',
        language: 'Python',
      },
    ],
  },
  {
    name: 'frontend',
    path: 'frontend',
    type: 'folder',
    children: [
      {
        name: 'App.tsx',
        path: 'frontend/App.tsx',
        type: 'file',
        language: 'TypeScript',
      },
      {
        name: 'index.css',
        path: 'frontend/index.css',
        type: 'file',
        language: 'CSS',
      },
    ],
  },
  {
    name: 'tests',
    path: 'tests',
    type: 'folder',
    children: [
      {
        name: 'test_auth.py',
        path: 'tests/test_auth.py',
        type: 'file',
        language: 'Python',
      },
    ],
  },
  {
    name: 'requirements.txt',
    path: 'requirements.txt',
    type: 'file',
    language: 'Text',
  },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'file',
    language: 'Markdown',
  },
  {
    name: '.env.example',
    path: '.env.example',
    type: 'file',
    language: 'Text',
  },
]