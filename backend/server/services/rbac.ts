import { getPool } from '../db/init';

export type Role = 'admin' | 'moderator' | 'support' | 'user';

export interface Permission {
  resource: string;
  actions: string[];
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    { resource: '*', actions: ['*'] }
  ],
  moderator: [
    { resource: 'reports', actions: ['read', 'update', 'resolve'] },
    { resource: 'users', actions: ['read', 'update', 'ban'] },
    { resource: 'content', actions: ['read', 'approve', 'reject'] },
    { resource: 'violations', actions: ['read', 'create'] },
    { resource: 'messages', actions: ['read'] },
    { resource: 'matches', actions: ['read'] }
  ],
  support: [
    { resource: 'users', actions: ['read', 'update'] },
    { resource: 'reports', actions: ['read'] },
    { resource: 'messages', actions: ['read'] }
  ],
  user: [
    { resource: 'profile', actions: ['read', 'update'] },
    { resource: 'swipes', actions: ['create'] },
    { resource: 'matches', actions: ['read'] },
    { resource: 'messages', actions: ['create', 'read'] }
  ]
};

export class RBACService {
  async getUserRole(userId: string): Promise<Role> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT role FROM users WHERE id = $1`,
      [userId]
    );

    return (result.rows[0]?.role as Role) || 'user';
  }

  async setUserRole(userId: string, role: Role): Promise<void> {
    const pool = getPool();
    
    await pool.query(
      `UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1`,
      [userId, role]
    );
  }

  hasPermission(userRole: Role, resource: string, action: string): boolean {
    const permissions = ROLE_PERMISSIONS[userRole];
    
    if (!permissions) return false;

    for (const permission of permissions) {
      if (permission.resource === '*' && permission.actions.includes('*')) {
        return true;
      }

      if (permission.resource === resource) {
        if (permission.actions.includes('*') || permission.actions.includes(action)) {
          return true;
        }
      }
    }

    return false;
  }

  async checkPermission(userId: string, resource: string, action: string): Promise<boolean> {
    const role = await this.getUserRole(userId);
    return this.hasPermission(role, resource, action);
  }

  getPermissionsForRole(role: Role): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  async getAccessibleResources(userId: string): Promise<Permission[]> {
    const role = await this.getUserRole(userId);
    return this.getPermissionsForRole(role);
  }
}

export const rbacService = new RBACService();
