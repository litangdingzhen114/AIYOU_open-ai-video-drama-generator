/**
 * useWorkflowActions - 工作流操作 Hook
 *
 * @developer 光波 (a@ggbo.com)
 * @copyright Copyright (c) 2025 光波. All rights reserved.
 * @description 工作流保存/加载/删除/重命名逻辑，数据只存数据库
 */

import { Workflow } from '../types';
import { useEditorStore } from '../stores/editor.store';
import { getApproxNodeHeight } from '../utils/nodeHelpers';
import { createProject, saveProjectSnapshot, updateProject, deleteProject as apiDeleteProject, getProject } from '../services/api';
import { setSyncProjectId, getSyncProjectId, setOnlineStatus } from '../services/syncMiddleware';
import { getNodeNameCN } from '../utils/nodeHelpers';
import { notifySuccess, notifyError } from '../stores/notification.store';

interface UseWorkflowActionsParams {
  saveHistory: () => void;
}

export function useWorkflowActions(params: UseWorkflowActionsParams) {
  const { saveHistory } = params;
  const {
    nodes, setNodes,
    connections, setConnections,
    groups, setGroups,
    workflows, setWorkflows,
    selectedWorkflowId, setSelectedWorkflowId,
    setIsLoadingWorkflow,
  } = useEditorStore();

  /** 保存当前画布到数据库（已有项目则更新，没有则创建） */
  const saveCurrentAsWorkflow = async () => {
      if (nodes.length === 0) {
          notifyError('保存失败', '画布为空，没有可保存的内容');
          return;
      }

      const currentProjectId = getSyncProjectId();

      if (currentProjectId) {
          // 更新当前项目
          try {
              console.log('[Workflow] 保存到项目:', currentProjectId, '节点数:', nodes.length);
              const res = await saveProjectSnapshot(currentProjectId, {
                  nodes: structuredClone(nodes),
                  connections: structuredClone(connections),
                  groups: structuredClone(groups),
              });
              if (res.success) {
                  notifySuccess('保存成功', `已保存 ${nodes.length} 个节点到数据库`);
              } else {
                  console.error('[Workflow] 保存失败:', res.error);
                  notifyError('保存失败', res.error || '未知错误');
              }
          } catch (e) {
              console.error('[Workflow] 保存异常:', e);
              notifyError('保存失败', '无法保存到数据库');
          }
      } else {
          // 没有当前项目，创建新项目并保存
          const title = `工作流 ${new Date().toLocaleDateString()}`;
          try {
              const res = await createProject(title);
              if (res.success && res.data) {
                  const projectId = res.data.id;
                  setSyncProjectId(projectId);
                  setOnlineStatus(true);
                  const saveRes = await saveProjectSnapshot(projectId, {
                      nodes: structuredClone(nodes),
                      connections: structuredClone(connections),
                      groups: structuredClone(groups),
                  });
                  if (!saveRes.success) {
                      notifyError('保存失败', saveRes.error || '快照保存失败');
                      return;
                  }
                  const newWf: Workflow = {
                      id: `wf-db-${projectId}`,
                      title,
                      thumbnail: '',
                      nodes: [], connections: [], groups: [],
                      projectId,
                  };
                  setWorkflows(prev => [newWf, ...prev]);
                  setSelectedWorkflowId(newWf.id);
                  notifySuccess('保存成功', `工作流「${title}」已创建并保存`);
              }
          } catch (e) {
              console.error('[Workflow] 创建项目失败:', e);
              notifyError('保存失败', '无法创建新项目');
          }
      }
  };

  const saveGroupAsWorkflow = async (groupId: string) => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;
      const nodesInGroup = nodes.filter(n => { const w = n.width || 420; const h = n.height || getApproxNodeHeight(n); const cx = n.x + w/2; const cy = n.y + h/2; return cx > group.x && cx < group.x + group.width && cy > group.y && cy < group.y + group.height; });
      const nodeIds = new Set(nodesInGroup.map(n => n.id));
      const connectionsInGroup = connections.filter(c => nodeIds.has(c.from) && nodeIds.has(c.to));
      const title = group.title || '未命名工作流';

      try {
          const res = await createProject(title);
          if (res.success && res.data) {
              const projectId = res.data.id;
              await saveProjectSnapshot(projectId, {
                  nodes: structuredClone(nodesInGroup),
                  connections: structuredClone(connectionsInGroup),
                  groups: [structuredClone(group)],
              });
              const newWf: Workflow = {
                  id: `wf-db-${projectId}`,
                  title,
                  thumbnail: '',
                  nodes: [], connections: [], groups: [],
                  projectId,
              };
              setWorkflows(prev => [newWf, ...prev]);
              notifySuccess('保存成功', `分组「${title}」已保存为工作流`);
          }
      } catch (e) {
          console.error('[Workflow] 保存分组失败:', e);
          notifyError('保存失败', '无法保存分组到数据库');
      }
  };

  /** 从数据库加载工作流 */
  const loadWorkflow = async (id: string) => {
      const wf = workflows.find(w => w.id === id);
      if (!wf || !wf.projectId) return;

      saveHistory();
      setSelectedWorkflowId(id);
      setSyncProjectId(wf.projectId);
      setOnlineStatus(true);
      setIsLoadingWorkflow(true);

      try {
          const res = await getProject(wf.projectId);
          if (res.success && res.data) {
                  const { nodes: dbNodes, connections: dbConns, groups: dbGroups } = res.data;
                  if (dbNodes && dbNodes.length > 0) {
                      const mappedNodes = dbNodes.map((n: any) => {
                          let data = n.data || {};
                          if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
                          let inputs = n.inputs || [];
                          if (typeof inputs === 'string') { try { inputs = JSON.parse(inputs); } catch { inputs = []; } }
                      return { ...n, data, inputs, title: n.title || getNodeNameCN(n.type) };
                      });
                  const mappedConns = (dbConns || []).map((c: any) => ({
                      id: c.id, from: c.from_node || c.from, to: c.to_node || c.to,
                  }));
                  setNodes(mappedNodes);
                  setConnections(mappedConns);
                  setGroups(dbGroups || []);
                  notifySuccess('已加载', `工作流「${wf.title}」`);
              } else {
                  setNodes([]);
                  setConnections([]);
                  setGroups([]);
                  notifySuccess('已加载', `空工作流「${wf.title}」`);
              }
          }
      } catch (e) {
          console.error('[Workflow] 加载失败:', e);
          notifyError('加载失败', '无法从服务端加载工作流数据');
      } finally {
          setIsLoadingWorkflow(false);
      }
  };

  const deleteWorkflow = async (id: string) => {
      const wf = workflows.find(w => w.id === id);
      if (wf?.projectId) {
          try { await apiDeleteProject(wf.projectId); } catch (e) { console.warn('[Workflow] 删除后端项目失败:', e); }
      }
      setWorkflows(prev => prev.filter(w => w.id !== id));
      if (selectedWorkflowId === id) setSelectedWorkflowId(null);
  };

  const renameWorkflow = async (id: string, newTitle: string) => {
      const wf = workflows.find(w => w.id === id);
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, title: newTitle } : w));
      if (wf?.projectId) {
          try { await updateProject(wf.projectId, { title: newTitle }); } catch (e) { console.warn('[Workflow] 重命名失败:', e); }
      }
  };

  /** 新建空工作流：清空画布，创建新的后端项目 */
  const createNewWorkflow = async () => {
      saveHistory();
      setNodes([]);
      setConnections([]);
      setGroups([]);
      setSelectedWorkflowId(null);

      try {
          const title = `工作流 ${new Date().toLocaleDateString()}`;
          const res = await createProject(title);
          if (res.success && res.data) {
              const projectId = res.data.id;
              setSyncProjectId(projectId);
              setOnlineStatus(true);
              const newWf: Workflow = {
                  id: `wf-db-${projectId}`,
                  title,
                  thumbnail: '',
                  nodes: [], connections: [], groups: [],
                  projectId,
              };
              setWorkflows(prev => [newWf, ...prev]);
              setSelectedWorkflowId(newWf.id);
          }
      } catch (e) {
          console.warn('[Workflow] 创建新项目失败:', e);
      }
  };

  return { saveCurrentAsWorkflow, saveGroupAsWorkflow, loadWorkflow, deleteWorkflow, renameWorkflow, createNewWorkflow };
}
