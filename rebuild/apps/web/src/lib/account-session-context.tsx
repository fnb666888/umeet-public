'use client';
import { createContext, useContext } from 'react';
export const AccountSessionContext = createContext(true);
export const useAccountSessionReady = () => useContext(AccountSessionContext);
