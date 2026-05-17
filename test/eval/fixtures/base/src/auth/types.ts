export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
}

export interface AuthToken {
  id: string;
  email: string;
  iat: number;
  exp: number;
}
