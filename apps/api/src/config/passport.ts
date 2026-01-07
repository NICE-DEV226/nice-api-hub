/**
 * Passport.js Configuration - Google OAuth
 * Author: NICE-DEV
 */

import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

export function configurePassport(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        scope: ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile: Profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          
          if (!email) {
            return done(new Error('No email found in Google profile'), undefined);
          }

          // Find or create user
          let user = await prisma.user.findUnique({
            where: { googleId: profile.id },
          });

          if (!user) {
            // Check if user exists with same email
            const existingUser = await prisma.user.findUnique({
              where: { email },
            });

            if (existingUser) {
              // Link Google account to existing user
              user = await prisma.user.update({
                where: { id: existingUser.id },
                data: {
                  googleId: profile.id,
                  avatar: profile.photos?.[0]?.value,
                  lastLoginAt: new Date(),
                },
              });
            } else {
              // Create new user
              user = await prisma.user.create({
                data: {
                  googleId: profile.id,
                  email,
                  name: profile.displayName || email.split('@')[0],
                  avatar: profile.photos?.[0]?.value,
                  role: 'USER',
                  plan: 'FREE',
                },
              });
              
              logger.info(`New user created: ${email}`);
            }
          } else {
            // Update last login + sync name/avatar from Google
            user = await prisma.user.update({
              where: { id: user.id },
              data: { 
                lastLoginAt: new Date(),
                // Sync name and avatar from Google on each login
                name: profile.displayName || user.name,
                avatar: profile.photos?.[0]?.value || user.avatar,
              },
            });
          }

          return done(null, user);
        } catch (error) {
          logger.error('Google OAuth error:', error);
          return done(error as Error, undefined);
        }
      }
    )
  );

  // Serialize user for session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
      });
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
}

export default passport;
