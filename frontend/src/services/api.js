import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL ||
  (window.location.port === '3000'
    ? 'http://localhost:5000/api'
    : `${window.location.protocol}//${window.location.hostname}:5000/api`);

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const login = (username, password) =>
  api.post('/auth/login', { username, password });

export const getMe = () =>
  api.get('/users/me');

export const getUsers = () =>
  api.get('/users');

export const getRoles = () =>
  api.get('/users/roles');

export const createUser = (data) =>
  api.post('/users', data);

export const getDepartments = () =>
  api.get('/departments');

export const createDepartment = (data) =>
  api.post('/departments', data);

export const getAreas = () =>
  api.get('/areas');

export const createArea = (data) =>
  api.post('/areas', data);

export const getAreaDashboard = (areaId, year, month) =>
  api.get(`/areas/${areaId}/dashboard?year=${year}&month=${month}`);

export const getAreaGaps = (areaId, year, month) =>
  api.get(`/areas/${areaId}/gaps?year=${year}&month=${month}`);

export const resolveAreaGaps = (areaId, data) =>
  api.post(`/areas/${areaId}/resolve-gaps`, data);

export const getRequests = () =>
  api.get('/requests');

export const createRequest = (data) =>
  api.post('/requests', data);

export const approveRequest = (id) =>
  api.post(`/requests/${id}/approve`);

export const rejectRequest = (id) =>
  api.post(`/requests/${id}/reject`);

export const getSchedules = () =>
  api.get('/schedules');

export const getSchedule = (year, month) =>
  api.get(`/schedules/${year}/${month}`);

export const generateSchedule = (data) =>
  api.post('/schedules/generate', data);

export const publishSchedule = (id) =>
  api.post(`/schedules/${id}/publish`);

export const getShifts = () =>
  api.get('/shifts');

export const updateShift = (id, data) =>
  api.put(`/shifts/${id}`, data);

// Straordinari
export const getOvertime = (params) =>
  api.get('/overtime', { params });

export const createOvertime = (data) =>
  api.post('/overtime', data);

export const deleteOvertime = (id) =>
  api.delete(`/overtime/${id}`);

export const getOvertimeSummaryAll = (params) =>
  api.get('/overtime/summary/all', { params });

export const getRestRecovery = (params) =>
  api.get('/overtime/rest-recovery', { params });

export const markRestRecovered = (id, data) =>
  api.patch(`/overtime/rest-recovery/${id}`, data);

export const getOvertimeLimits = (userId, year) =>
  api.get(`/overtime/limits/${userId}`, { params: { year } });

export const setOvertimeLimits = (userId, data) =>
  api.put(`/overtime/limits/${userId}`, data);

// Regole di lavoro
export const getWorkRules = () =>
  api.get('/work-rules');

export const updateWorkRule = (key, value) =>
  api.put(`/work-rules/${key}`, { rule_value: value });

export default api;
