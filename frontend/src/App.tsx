import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import AgentPage from './pages/AgentPage';
import RunPage from './pages/RunPage';
import SettingsPage from './pages/SettingsPage';
import KnowledgePage from './pages/KnowledgePage';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/" element={<AgentPage />} />
                    <Route path="/run/:id" element={<RunPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/knowledge" element={<KnowledgePage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
