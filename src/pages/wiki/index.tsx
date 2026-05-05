import React from "react";
import { Routes, Route } from "react-router-dom";
import WikiEditorComponent from "../../components/wiki/WikiEditor";
import WikiList from "./WikiList";
import WikiTimeline from "./WikiTimeline";
import WikiPageView from "./WikiPageView";
import WikiBranchWorkspace from "./WikiBranchWorkspace";
import WikiPullRequestList from "./WikiPullRequestList";
import WikiPullRequestDetail from "./WikiPullRequestDetail";
import WikiHistory from "./WikiHistory";

const Wiki = () => {
	return (
		<Routes>
			<Route path="/" element={<WikiList />} />
			<Route path="/new" element={<WikiEditorComponent />} />
			<Route path="/timeline" element={<WikiTimeline />} />
			<Route path="/:slug" element={<WikiPageView />} />
			<Route path="/:slug/branches" element={<WikiBranchWorkspace />} />
			<Route path="/:slug/prs" element={<WikiPullRequestList />} />
			<Route path="/:slug/prs/:prId" element={<WikiPullRequestDetail />} />
			<Route path="/:slug/edit" element={<WikiEditorComponent />} />
			<Route path="/:slug/history" element={<WikiHistory />} />
		</Routes>
	);
};

export default Wiki;
