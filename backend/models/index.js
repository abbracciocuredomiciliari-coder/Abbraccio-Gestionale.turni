const { Sequelize } = require('sequelize');
const config = require('../config/sequelize');

const env = process.env.NODE_ENV || 'development';
const cfg = config[env];

const sequelize = new Sequelize(
  cfg.database || cfg.storage,
  cfg.username,
  cfg.password,
  { ...cfg }
);

// ── Import modelli ──
const Role             = require('./Role')(sequelize);
const User             = require('./User')(sequelize);
const Competency       = require('./Competency')(sequelize);
const NurseCompetency  = require('./NurseCompetency')(sequelize);
const ShiftType        = require('./ShiftType')(sequelize);
const ShiftWeight      = require('./ShiftWeight')(sequelize);
const UserConstraint   = require('./UserConstraint')(sequelize);
const RequestType      = require('./RequestType')(sequelize);
const RequestStatus    = require('./RequestStatus')(sequelize);
const Request          = require('./Request')(sequelize);
const Schedule         = require('./Schedule')(sequelize);
const ScheduleAssignment = require('./ScheduleAssignment')(sequelize);
const OvertimeAssignment = require('./OvertimeAssignment')(sequelize);
const RestRecovery     = require('./RestRecovery')(sequelize);
const OvertimeLimit    = require('./OvertimeLimit')(sequelize);
const WorkRule         = require('./WorkRule')(sequelize);

// ── Associazioni ──

// Role → User
Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

// ShiftType → ShiftWeight (lookup per peso configurabile)
// NB: non è una FK intera ma una relazione logica via weight_key (stringa)
// Per query ORM si usa: ShiftType.findAll({ include: 'weight' })
ShiftType.hasOne(ShiftWeight, { foreignKey: 'weight_key', sourceKey: 'weight_key', as: 'weight', constraints: false });
ShiftWeight.belongsTo(ShiftType, { foreignKey: 'weight_key', targetKey: 'weight_key', as: 'shiftType', constraints: false });

// User → NurseCompetency → Competency  (M:N con tabella di join)
User.belongsToMany(Competency, { through: NurseCompetency, foreignKey: 'user_id', as: 'competencies' });
Competency.belongsToMany(User, { through: NurseCompetency, foreignKey: 'competency_id', as: 'nurses' });
NurseCompetency.belongsTo(User,       { foreignKey: 'user_id' });
NurseCompetency.belongsTo(Competency, { foreignKey: 'competency_id' });

// User → UserConstraint → ShiftType
User.hasMany(UserConstraint, { foreignKey: 'user_id', as: 'constraints' });
ShiftType.hasMany(UserConstraint, { foreignKey: 'shift_type_id' });
UserConstraint.belongsTo(User,      { foreignKey: 'user_id' });
UserConstraint.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });

// User → Request
User.hasMany(Request, { foreignKey: 'user_id', as: 'requests' });
Request.belongsTo(User,          { foreignKey: 'user_id',    as: 'requester' });
Request.belongsTo(User,          { foreignKey: 'approved_by', as: 'approver' });
Request.belongsTo(RequestType,   { foreignKey: 'request_type_id', as: 'requestType' });
Request.belongsTo(RequestStatus, { foreignKey: 'status_id',       as: 'status' });
Request.belongsTo(ShiftType,     { foreignKey: 'shift_type_id',   as: 'shiftType' });

// Schedule → ScheduleAssignment
Schedule.hasMany(ScheduleAssignment, { foreignKey: 'schedule_id', as: 'assignments', onDelete: 'CASCADE' });
ScheduleAssignment.belongsTo(Schedule,  { foreignKey: 'schedule_id' });
ScheduleAssignment.belongsTo(User,      { foreignKey: 'user_id',       as: 'nurse' });
ScheduleAssignment.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });

// User → OvertimeAssignment
User.hasMany(OvertimeAssignment, { foreignKey: 'user_id', as: 'overtimeAssignments' });
OvertimeAssignment.belongsTo(User,      { foreignKey: 'user_id',       as: 'nurse' });
OvertimeAssignment.belongsTo(User,      { foreignKey: 'authorized_by', as: 'authorizedBy' });
OvertimeAssignment.belongsTo(ShiftType, { foreignKey: 'shift_type_id', as: 'shiftType' });
OvertimeAssignment.belongsTo(Schedule,  { foreignKey: 'schedule_id' });

// User → RestRecovery
User.hasMany(RestRecovery, { foreignKey: 'user_id', as: 'restRecoveries' });
RestRecovery.belongsTo(User, { foreignKey: 'user_id', as: 'nurse' });

// User → OvertimeLimit
User.hasMany(OvertimeLimit, { foreignKey: 'user_id', as: 'overtimeLimits' });
OvertimeLimit.belongsTo(User, { foreignKey: 'user_id' });
OvertimeLimit.belongsTo(User, { foreignKey: 'set_by', as: 'setBy' });

module.exports = {
  sequelize,
  Sequelize,
  Role,
  User,
  Competency,
  NurseCompetency,
  ShiftType,
  ShiftWeight,
  UserConstraint,
  RequestType,
  RequestStatus,
  Request,
  Schedule,
  ScheduleAssignment,
  OvertimeAssignment,
  RestRecovery,
  OvertimeLimit,
  WorkRule,
};
