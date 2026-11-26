import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import Login from './pages/Login'
import Me from './pages/Me'
import NewsDetail from './pages/NewsDetail'
import NewsList from './pages/NewsList'
import NewShareDetail from './pages/NewShareDetail'
import NewShareList from './pages/NewShareList'
import ProjectProgressDetail from './pages/ProjectProgressDetail'
import ProjectProgressList from './pages/ProjectProgressList'
import FinancingEventDetail from './pages/FinancingEventDetail'
import FinancingEventList from './pages/FinancingEventList'
import ValuationDetail from './pages/ValuationDetail'
import ValuationList from './pages/ValuationList'
import CompetitorDetail from './pages/CompetitorDetail'
import CompetitorList from './pages/CompetitorList'
import PerformanceBoard from './pages/PerformanceBoard'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/news/:id"
        element={
          <RequireAuth>
            <NewsDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/listing/new-share/:id"
        element={
          <RequireAuth>
            <NewShareDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/listing/progress/:id"
        element={
          <RequireAuth>
            <ProjectProgressDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/financing/:id"
        element={
          <RequireAuth>
            <FinancingEventDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/valuation/:id"
        element={
          <RequireAuth>
            <ValuationDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/competitor/:tab/:id"
        element={
          <RequireAuth>
            <CompetitorDetail />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/news" element={<NewsList />} />
        <Route path="/listing/new-share" element={<NewShareList />} />
        <Route path="/listing/progress" element={<ProjectProgressList />} />
        <Route path="/financing" element={<FinancingEventList />} />
        <Route path="/valuation" element={<ValuationList />} />
        <Route path="/competitor" element={<CompetitorList />} />
        <Route path="/performance" element={<PerformanceBoard />} />
        <Route path="/me" element={<Me />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
