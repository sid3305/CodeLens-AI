import {
  GitBranch,
  FolderGit2,
  RefreshCw,
  AlertTriangle,
  Code2,
  Files,
  CheckCircle2,
  XCircle,
  Search,
  ChevronDown,
  ExternalLink,
  Link,
  GitMerge,
  Package,
  Zap,
  Eye,
  RotateCcw,
  Layout,
  Network,
} from 'lucide-react'

import { useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

import {
  api,
  type DependenciesAnalysisResponse,
  type CircularDependency,
  type ExternalDependency,
  type ModuleDependency,
  type DependenciesGraphData,
} from '../../services/api'
import type { Repository } from '../../types'

interface DependenciesPanelProps {
  repository: Repository | null
  onRefresh?: () => void
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

function CircularDependencyCard({
  cycle,
  onFocus,
}: {
  cycle: CircularDependency
  onFocus: (module: string) => void
}) {
  return (
    <article className="finding-card">
      <div className="finding-card-header">
        <div className="finding-heading">
          <div className="finding-labels">
            <span className={`severity-badge ${cycle.severity.toLowerCase()}`}>
              {cycle.severity}
            </span>
            <span className="finding-category">Circular Import</span>
          </div>
          <h3>Circular Dependency ({cycle.cycle.length} modules)</h3>
          <span className="finding-rule">{cycle.cycle_type}</span>
        </div>
      </div>

      <p className="finding-description">{cycle.description}</p>

      <div className="circular-cycle-visualization">
        {cycle.cycle.map((mod, idx) => (
          <div key={idx} className="cycle-step">
            <button
              className="cycle-module"
              onClick={() => onFocus(mod)}
              title="Focus on this module"
            >
              {mod.split('/').pop() || mod}
            </button>
            {idx < cycle.cycle.length - 1 && (
              <GitMerge size={16} className="cycle-arrow" />
            )}
          </div>
        ))}
        {/* Close the loop */}
        <div className="cycle-step">
          <button
            className="cycle-module"
            onClick={() => onFocus(cycle.cycle[0])}
            title="Back to start"
          >
            {cycle.cycle[0].split('/').pop() || cycle.cycle[0]}
          </button>
        </div>
      </div>

      <div className="finding-footer">
        <span className="finding-duplicate">
          {cycle.cycle.length} modules in cycle
        </span>
      </div>
    </article>
  )
}

function ExternalDependencyCard({
  dep,
  onViewDetails,
}: {
  dep: ExternalDependency
  onViewDetails: (name: string) => void
}) {
  return (
    <article className={`dependency-card ${dep.is_dev_dependency ? 'dev-dependency' : ''}`}>
      <div className="dependency-header">
        <div className="dependency-name-row">
          <Package size={18} className="dep-icon" />
          <div>
            <strong>{dep.name}</strong>
            {dep.version && <span className="dep-version">{dep.version}</span>}
            {dep.is_dev_dependency && (
              <span className="dep-badge dev">Dev</span>
            )}
          </div>
        </div>
        <div className="dependency-meta">
          <span className="dep-language">{dep.language}</span>
          <span className="dep-import-count">{dep.import_count} imports</span>
        </div>
      </div>

      <div className="dependency-sources">
        {dep.source_files.slice(0, 3).map((file, idx) => (
          <span key={idx} className="dep-source-file" title={file}>
            {file.split('/').pop() || file}
          </span>
        ))}
        {dep.source_files.length > 3 && (
          <span className="dep-source-more">+{dep.source_files.length - 3} more</span>
        )}
      </div>

      <div className="dependency-actions">
        <button
          className="icon-button small"
          onClick={() => onViewDetails(dep.name)}
          title="View dependency details"
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </article>
  )
}

function ModuleDependencyList({
  dependencies,
  onFocusModule,
}: {
  dependencies: ModuleDependency[]
  onFocusModule: (module: string) => void
}) {
  return (
    <div className="module-deps-list">
      {dependencies.map((dep, idx) => (
        <div key={idx} className="module-dep-row">
          <button
            className="module-link source"
            onClick={() => onFocusModule(dep.source_module)}
            title="Focus source module"
          >
            {dep.source_module.split('/').pop() || dep.source_module}
          </button>
          <span className="dep-arrow">→</span>
          <button
            className="module-link target"
            onClick={() => onFocusModule(dep.target_module)}
            title="Focus target module"
          >
            {dep.target_module.split('/').pop() || dep.target_module}
          </button>
          {dep.imports.length > 0 && (
            <span className="dep-imports">
              {dep.imports.slice(0, 3).join(', ')}
              {dep.imports.length > 3 && ` +${dep.imports.length - 3} more`}
            </span>
          )}
          <span className="dep-edge-count">×{dep.edge_count}</span>
        </div>
      ))}
    </div>
  )
}

export default function DependenciesPanel({
  repository,
  onRefresh,
}: DependenciesPanelProps) {
  const [analysis, setAnalysis] = useState<DependenciesAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'circular' | 'external' | 'modules' | 'graph'>('overview')
  const [focusedModule, setFocusedModule] = useState<string | null>(null)
  const [graphView, setGraphView] = useState<'full' | 'modules'>('modules')

  const loadDependencies = useCallback(async () => {
    if (!repository) return

    setLoading(true)
    setError(null)

    try {
      const result = await api.getDependenciesAnalysis(repository.id)
      setAnalysis(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dependencies')
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    if (repository) {
      loadDependencies()
    }
  }, [repository, loadDependencies])

  const handleRefresh = () => {
    loadDependencies()
    onRefresh?.()
  }

  if (!repository) {
    return (
      <section className="content-section">
        <div className="empty-content repository-welcome">
          <FolderGit2 size={34} />
          <h3>No repository selected</h3>
          <p>Import a repository to analyze its dependencies.</p>
        </div>
      </section>
    )
  }

  const stats = analysis?.stats

  return (
    <section className="content-section">
      <div className="section-title-row">
        <div>
          <h2>
            <Link size={22} /> Dependencies Analysis
          </h2>
          <p>Module imports, circular dependencies, and external packages</p>
        </div>
        <div className="section-actions">
          <button
            className="icon-button"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh dependencies analysis"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button className="icon-button small" onClick={loadDependencies}>
            <RotateCcw size={14} />
          </button>
        </div>
      )}

      {/* Stats Overview */}
      {analysis && (
        <div className="overview-stats dependencies-stats">
          <StatCard
            icon={<Files />}
            label="Modules"
            value={analysis.total_internal_modules}
            color="blue"
          />
          <StatCard
            icon={<Package />}
            label="External Deps"
            value={analysis.total_external_dependencies}
            color="purple"
          />
          <StatCard
            icon={<GitMerge />}
            label="Circular Deps"
            value={stats?.circular_import_count ?? 0}
            color={stats && stats.circular_import_count > 0 ? 'orange' : 'teal'}
          />
          <StatCard
            icon={<Zap />}
            label="Import Edges"
            value={stats?.total_imports ?? 0}
            color="blue"
          />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="dependencies-tabs">
        <button
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Layout size={16} /> Overview
        </button>
        <button
          className={`tab-button ${activeTab === 'circular' ? 'active' : ''}`}
          onClick={() => setActiveTab('circular')}
        >
          <GitMerge size={16} />
          Circular ({analysis?.circular_dependencies.length ?? 0})
        </button>
        <button
          className={`tab-button ${activeTab === 'external' ? 'active' : ''}`}
          onClick={() => setActiveTab('external')}
        >
          <Package size={16} />
          External ({analysis?.external_dependencies.length ?? 0})
        </button>
        <button
          className={`tab-button ${activeTab === 'modules' ? 'active' : ''}`}
          onClick={() => setActiveTab('modules')}
        >
          <Network size={16} />
          Modules ({analysis?.module_dependencies.length ?? 0})
        </button>
        <button
          className={`tab-button ${activeTab === 'graph' ? 'active' : ''}`}
          onClick={() => setActiveTab('graph')}
        >
          <GitBranch size={16} />
          Graph
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'overview' && analysis && (
          <DependenciesOverview
            analysis={analysis}
            onFocusModule={setFocusedModule}
          />
        )}

        {activeTab === 'circular' && analysis && (
          <CircularDependenciesTab
            circular={analysis.circular_dependencies}
            onFocusModule={setFocusedModule}
          />
        )}

        {activeTab === 'external' && analysis && (
          <ExternalDependenciesTab
            external={analysis.external_dependencies}
            onViewDetails={(name) => console.log('View details:', name)}
          />
        )}

        {activeTab === 'modules' && analysis && (
          <ModuleDependenciesTab
            modules={analysis.module_dependencies}
            onFocusModule={setFocusedModule}
          />
        )}

        {activeTab === 'graph' && analysis && (
          <DependenciesGraphTab
            graphData={analysis.dependency_graph_data}
            view={graphView}
            onViewChange={setGraphView}
            focusedModule={focusedModule}
            onFocusModule={setFocusedModule}
          />
        )}
      </div>

      {/* Language Breakdown */}
      {analysis && (
        <details className="analysis-details">
          <summary>
            <div>
              <strong>Language Breakdown</strong>
              <span>Files and dependencies per language</span>
            </div>
            <ChevronDown size={17} className="details-chevron" />
          </summary>
          <div className="analysis-details-content">
            <div className="language-breakdown-table">
              {Object.entries(analysis.language_breakdown).map(([lang, stats]) => (
                <div key={lang} className="language-row">
                  <div className="lang-info">
                    <Code2 size={16} className={`lang-icon ${lang}`} />
                    <strong>{lang}</strong>
                  </div>
                  <div className="lang-stats">
                    <span>{stats.files} files</span>
                    <span>{stats.internal_deps} internal deps</span>
                    <span>{stats.external_deps} external deps</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}
    </section>
  )
}

// Sub-components for each tab

function DependenciesOverview({
  analysis,
  onFocusModule,
}: {
  analysis: DependenciesAnalysisResponse
  onFocusModule: (module: string) => void
}) {
  const topCircular = analysis.circular_dependencies.slice(0, 3)
  const topExternal = analysis.external_dependencies
    .sort((a, b) => b.import_count - a.import_count)
    .slice(0, 5)
  const topModules = analysis.module_dependencies
    .sort((a, b) => b.edge_count - a.edge_count)
    .slice(0, 10)

  return (
    <div className="dependencies-overview">
      {/* Circular Dependencies Summary */}
      <div className="overview-section">
        <h3>
          <GitMerge size={18} /> Circular Dependencies
          <span className="section-count">{analysis.circular_dependencies.length} found</span>
        </h3>
        {topCircular.length > 0 ? (
          <div className="circular-preview">
            {topCircular.map((cycle, idx) => (
              <div key={idx} className="circular-preview-item">
                <span className={`severity-badge ${cycle.severity.toLowerCase()}`}>
                  {cycle.severity}
                </span>
                <span className="cycle-path">
                  {cycle.cycle.map((m, i) => (
                    <>
                      <button
                        className="cycle-module-inline"
                        onClick={() => onFocusModule(m)}
                      >
                        {m.split('/').pop() || m}
                      </button>
                      {i < cycle.cycle.length - 1 && <span> → </span>}
                    </>
                  ))}
                </span>
              </div>
            ))}
            {analysis.circular_dependencies.length > 3 && (
              <button
                className="secondary-button small"
                onClick={() => {}}
              >
                View all {analysis.circular_dependencies.length} circular dependencies
              </button>
            )}
          </div>
        ) : (
          <div className="empty-content compact-empty">
            <CheckCircle2 size={20} />
            <p>No circular dependencies detected!</p>
          </div>
        )}
      </div>

      {/* Top External Dependencies */}
      <div className="overview-section">
        <h3>
          <Package size={18} /> Top External Dependencies
          <span className="section-count">{analysis.external_dependencies.length} packages</span>
        </h3>
        {topExternal.length > 0 ? (
          <div className="external-preview">
            {topExternal.map((dep) => (
              <div key={dep.name} className="external-preview-item">
                <Package size={16} className="dep-icon" />
                <div className="dep-info">
                  <strong>{dep.name}</strong>
                  <span>{dep.import_count} imports across {dep.source_files.length} files</span>
                </div>
                {dep.version && <span className="dep-version">{dep.version}</span>}
                {dep.is_dev_dependency && <span className="dep-badge dev">Dev</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-content compact-empty">
            <Package size={20} />
            <p>No external dependencies found</p>
          </div>
        )}
      </div>

      {/* Most Connected Modules */}
      <div className="overview-section">
        <h3>
          <Network size={18} /> Most Connected Modules
          <span className="section-count">{analysis.module_dependencies.length} relationships</span>
        </h3>
        {topModules.length > 0 ? (
          <ModuleDependencyList
            dependencies={topModules}
            onFocusModule={onFocusModule}
          />
        ) : (
          <div className="empty-content compact-empty">
            <Network size={20} />
            <p>No module dependencies found</p>
          </div>
        )}
      </div>
    </div>
  )
}

function CircularDependenciesTab({
  circular,
  onFocusModule,
}: {
  circular: CircularDependency[]
  onFocusModule: (module: string) => void
}) {
  if (circular.length === 0) {
    return (
      <div className="empty-content">
        <CheckCircle2 size={32} />
        <h3>No Circular Dependencies</h3>
        <p>Your codebase has no circular import chains. Great job!</p>
      </div>
    )
  }

  return (
    <div className="circular-dependencies-list">
      {circular.map((cycle, idx) => (
        <CircularDependencyCard key={idx} cycle={cycle} onFocus={onFocusModule} />
      ))}
    </div>
  )
}

function ExternalDependenciesTab({
  external,
  onViewDetails,
}: {
  external: ExternalDependency[]
  onViewDetails: (name: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'prod' | 'dev'>('all')
  const [search, setSearch] = useState('')

  const filtered = external
    .filter((dep) => {
      if (filter === 'prod' && dep.is_dev_dependency) return false
      if (filter === 'dev' && !dep.is_dev_dependency) return false
      return true
    })
    .filter((dep) =>
      dep.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => b.import_count - a.import_count)

  return (
    <div className="external-dependencies-tab">
      <div className="external-filters">
        <div className="filter-group">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packages..."
            className="filter-input"
          />
        </div>
        <div className="filter-group">
          <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as 'all' | 'prod' | 'dev')} className="filter-select">
            <option value="all">All</option>
            <option value="prod">Production</option>
            <option value="dev">Development</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-content compact-empty">
          <Package size={20} />
          <p>No external dependencies match your filters</p>
        </div>
      ) : (
        <div className="external-deps-grid">
          {filtered.map((dep) => (
            <ExternalDependencyCard
              key={dep.name}
              dep={dep}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ModuleDependenciesTab({
  modules,
  onFocusModule,
}: {
  modules: ModuleDependency[]
  onFocusModule: (module: string) => void
}) {
  const [search, setSearch] = useState('')

  const filtered = modules
    .filter((dep) =>
      dep.source_module.toLowerCase().includes(search.toLowerCase()) ||
      dep.target_module.toLowerCase().includes(search.toLowerCase()) ||
      dep.imports.some((imp) => imp.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => b.edge_count - a.edge_count)

  return (
    <div className="module-dependencies-tab">
      <div className="module-filters">
        <div className="filter-group">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules or imports..."
            className="filter-input"
          />
        </div>
        <span className="result-count">
          {filtered.length} of {modules.length} dependencies
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-content compact-empty">
          <Network size={20} />
          <p>No module dependencies match your search</p>
        </div>
      ) : (
        <ModuleDependencyList
          dependencies={filtered}
          onFocusModule={onFocusModule}
        />
      )}
    </div>
  )
}

function DependenciesGraphTab({
  graphData,
  view,
  onViewChange,
  focusedModule,
  onFocusModule,
}: {
  graphData: DependenciesGraphData
  view: 'full' | 'modules'
  onViewChange: (view: 'full' | 'modules') => void
  focusedModule: string | null
  onFocusModule: (module: string) => void
}) {
  return (
    <div className="dependencies-graph-tab">
      <div className="graph-controls">
        <div className="view-toggle">
          <button
            className={`view-button ${view === 'modules' ? 'active' : ''}`}
            onClick={() => onViewChange('modules')}
          >
            <Layout size={16} /> Module Graph
          </button>
          <button
            className={`view-button ${view === 'full' ? 'active' : ''}`}
            onClick={() => onViewChange('full')}
          >
            <Network size={16} /> Full Graph
          </button>
        </div>

        {focusedModule && (
          <div className="focused-indicator">
            <Eye size={14} />
            Focused: <strong>{focusedModule.split('/').pop() || focusedModule}</strong>
            <button className="icon-button small" onClick={() => onFocusModule('')}>
              <XCircle size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="graph-container">
        {view === 'modules' && graphData.moduleGraph ? (
          <ModuleGraphView
            graphData={graphData.moduleGraph}
            focusedModule={focusedModule}
            onFocusModule={onFocusModule}
          />
        ) : (
          <FullGraphView
            graphData={graphData}
          />
        )}
      </div>
    </div>
  )
}

function ModuleGraphView({
  graphData,
  focusedModule,
  onFocusModule,
}: {
  graphData: { nodes: any[]; edges: any[] }
  focusedModule: string | null
  onFocusModule: (module: string) => void
}) {
  return (
    <div className="graph-placeholder">
      <Network size={48} />
      <h3>Module Dependency Graph</h3>
      <p>{graphData.nodes.length} modules, {graphData.edges.length} dependencies</p>
      <p className="graph-note">
        Interactive React Flow visualization will be implemented here.
        Click modules to focus, drag to pan, scroll to zoom.
      </p>
      {focusedModule && (
        <button className="primary-button" onClick={() => onFocusModule('')}>
          <XCircle size={16} /> Clear Focus
        </button>
      )}
    </div>
  )
}

function FullGraphView({
  graphData,
}: {
  graphData: DependenciesGraphData
}) {
  return (
    <div className="graph-placeholder">
      <GitBranch size={48} />
      <h3>Full Code Graph</h3>
      <p>{graphData.totalNodes} total nodes, {graphData.totalEdges} total edges</p>
      <p>Showing {graphData.showingNodes} nodes, {graphData.showingEdges} edges</p>
      <p className="graph-note">
        Interactive React Flow visualization with folder grouping,
        click-to-expand, and edge type filtering.
      </p>
    </div>
  )
}