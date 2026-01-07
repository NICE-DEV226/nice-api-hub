/**
 * Express type extensions
 * Author: NICE-DEV
 */

import { Plan, Role } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      role: Role;
      plan: Plan;
      isActive?: boolean;
    }

    interface Request {
      user?: User;
      apiKey?: {
        id: string;
        userId: string;
        name: string;
        environment: string;
        permissions: string[];
      };
    }
  }
}

export {};
