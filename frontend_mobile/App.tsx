import 'react-native-gesture-handler';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import * as SQLite from 'expo-sqlite';

type RootStackParamList = {
  Shell: undefined;
  RecipeDetail: { recipeId: string };
  CookingMode: { recipeId: string };
};

type TabParamList = {
  Home: undefined;
  Search: undefined;
  Favorites: undefined;
  Grocery: undefined;
  Profile: undefined;
};

type Difficulty = 'Easy' | 'Medium' | 'Hard';

type Recipe = {
  id: string;
  title: string;
  summary: string;
  cuisine: string;
  diet: string[];
  allergens: string[];
  totalMinutes: number;
  difficulty: Difficulty;
  servings: number;
  imageUrl?: string;
  heroColor: string;
  tags: string[];
  ingredients: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    category: GroceryCategory;
  }>;
  steps: Array<{
    id: string;
    title: string;
    body: string;
    timerSeconds?: number;
  }>;
  nutrition?: {
    calories: number;
    protein: string;
    carbs: string;
    fat: string;
  };
  attribution?: string;
};

type Collection = {
  id: string;
  name: string;
  recipeIds: string[];
};

type GroceryCategory = 'Produce' | 'Dairy' | 'Pantry' | 'Protein' | 'Spices' | 'Frozen' | 'Bakery';

type GroceryItem = {
  id: string;
  label: string;
  amount: string;
  category: GroceryCategory;
  checked: boolean;
  sourceRecipeIds: string[];
};

type UserPreferences = {
  diets: string[];
  allergens: string[];
  quickFilters: string[];
};

type UserProfile = {
  fullName: string;
  email: string;
  analyticsEnabled: boolean;
  onboardingCompleted: boolean;
};

type CookingProgress = Record<
  string,
  {
    completedStepIds: string[];
  }
>;

type AnalyticsEventName =
  | 'app_open'
  | 'onboarding_completed'
  | 'auth_signed_in'
  | 'recipe_opened'
  | 'recipe_saved'
  | 'collection_created'
  | 'grocery_generated'
  | 'cooking_started'
  | 'privacy_export_requested'
  | 'privacy_delete_requested';

type AnalyticsEvent = {
  name: AnalyticsEventName;
  payload: Record<string, unknown>;
  timestamp: string;
};

type ApiRecipeSummary = {
  id: string;
  title: string;
  cuisine?: string;
  summary?: string;
};

type AppState = {
  recipes: Recipe[];
  favorites: string[];
  collections: Collection[];
  groceryItems: GroceryItem[];
  preferences: UserPreferences;
  profile: UserProfile;
  cookingProgress: CookingProgress;
  analyticsQueue: AnalyticsEvent[];
  authToken?: string;
};

type AppAction =
  | { type: 'HYDRATE'; payload: AppState }
  | { type: 'COMPLETE_ONBOARDING'; payload: { preferences: UserPreferences; profile: Partial<UserProfile> } }
  | { type: 'SIGN_IN'; payload: { email: string; fullName: string; authToken: string } }
  | { type: 'SIGN_OUT' }
  | { type: 'TOGGLE_FAVORITE'; payload: { recipeId: string } }
  | { type: 'CREATE_COLLECTION'; payload: { name: string; recipeIds: string[] } }
  | { type: 'UPDATE_COLLECTION'; payload: Collection }
  | { type: 'DELETE_COLLECTION'; payload: { collectionId: string } }
  | { type: 'SET_GROCERY_ITEMS'; payload: GroceryItem[] }
  | { type: 'TOGGLE_GROCERY_ITEM'; payload: { itemId: string } }
  | { type: 'UPDATE_PROFILE'; payload: Partial<UserProfile> }
  | { type: 'MARK_STEP_COMPLETE'; payload: { recipeId: string; stepId: string } }
  | { type: 'CLEAR_USER_DATA' }
  | { type: 'QUEUE_ANALYTICS'; payload: AnalyticsEvent }
  | { type: 'CLEAR_ANALYTICS_QUEUE' };

type AppContextValue = {
  state: AppState;
  recipeMap: Map<string, Recipe>;
  recommendedRecipes: Recipe[];
  searchRecipes: (params: SearchFilters) => Promise<Recipe[]>;
  getRecipeById: (recipeId: string) => Recipe | undefined;
  toggleFavorite: (recipeId: string) => void;
  createCollection: (name: string, recipeIds: string[]) => void;
  updateCollection: (collection: Collection) => void;
  deleteCollection: (collectionId: string) => void;
  generateGroceryList: (recipeIds: string[]) => void;
  toggleGroceryItem: (itemId: string) => void;
  completeOnboarding: (preferences: UserPreferences, profile: Partial<UserProfile>) => void;
  signIn: (mode: 'email' | 'google' | 'apple', email: string, password?: string) => Promise<void>;
  signOut: () => Promise<void>;
  markStepComplete: (recipeId: string, stepId: string) => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
  exportPrivacyData: () => Promise<string>;
  deletePrivacyData: () => Promise<void>;
  trackEvent: (name: AnalyticsEventName, payload: Record<string, unknown>) => Promise<void>;
  isHydrated: boolean;
};

type SearchFilters = {
  query: string;
  diets: string[];
  allergens: string[];
  maxMinutes?: number;
  difficulty?: Difficulty | 'Any';
};

const STORAGE_KEYS = {
  appState: 'recipe-companion-app-state-v1',
  authToken: 'recipe-companion-auth-token',
} as const;

const APP_THEME = {
  colors: {
    primary: '#3b82f6',
    secondary: '#64748b',
    accent: '#06b6d4',
    background: '#f9fafb',
    surface: '#ffffff',
    text: '#111827',
    muted: '#6b7280',
    border: '#e5e7eb',
    success: '#06b6d4',
    error: '#ef4444',
    warning: '#f59e0b',
    heroBlue: '#dbeafe',
    heroCyan: '#cffafe',
    chip: '#eff6ff',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 20,
    pill: 999,
  },
};

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: APP_THEME.colors.background,
    card: APP_THEME.colors.surface,
    text: APP_THEME.colors.text,
    primary: APP_THEME.colors.primary,
    border: APP_THEME.colors.border,
  },
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const seedRecipes: Recipe[] = [
  {
    id: '1',
    title: 'Citrus Salmon Power Bowl',
    summary: 'A bright, protein-packed dinner with herbed rice, salmon, and crisp vegetables.',
    cuisine: 'Modern',
    diet: ['High Protein', 'Gluten Free'],
    allergens: ['Fish'],
    totalMinutes: 30,
    difficulty: 'Easy',
    servings: 2,
    heroColor: '#dbeafe',
    tags: ['Quick dinner', 'Weeknight', 'Meal prep'],
    ingredients: [
      { id: '1-1', name: 'salmon fillet', quantity: 2, unit: 'pieces', category: 'Protein' },
      { id: '1-2', name: 'brown rice', quantity: 1, unit: 'cup', category: 'Pantry' },
      { id: '1-3', name: 'cucumber', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '1-4', name: 'avocado', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '1-5', name: 'olive oil', quantity: 2, unit: 'tbsp', category: 'Pantry' },
      { id: '1-6', name: 'lemon', quantity: 1, unit: 'whole', category: 'Produce' },
    ],
    steps: [
      { id: '1-s1', title: 'Cook the rice', body: 'Rinse brown rice and simmer until tender. Fluff with a fork.', timerSeconds: 1200 },
      { id: '1-s2', title: 'Season salmon', body: 'Rub salmon with olive oil, lemon zest, salt, and pepper.' },
      { id: '1-s3', title: 'Pan sear', body: 'Sear salmon skin-side down until crisp, then finish until cooked through.', timerSeconds: 480 },
      { id: '1-s4', title: 'Assemble bowls', body: 'Layer rice, sliced vegetables, avocado, and salmon. Finish with lemon juice.' },
    ],
    nutrition: { calories: 520, protein: '34g', carbs: '39g', fat: '26g' },
    attribution: 'Recipe Companion Kitchen',
  },
  {
    id: '2',
    title: 'Creamy Coconut Chickpea Curry',
    summary: 'A pantry-friendly curry with chickpeas, spinach, and warming spices.',
    cuisine: 'Indian-inspired',
    diet: ['Vegetarian', 'Dairy Free'],
    allergens: [],
    totalMinutes: 25,
    difficulty: 'Easy',
    servings: 4,
    heroColor: '#cffafe',
    tags: ['Comforting', 'Pantry staples', 'One pan'],
    ingredients: [
      { id: '2-1', name: 'chickpeas', quantity: 2, unit: 'cans', category: 'Pantry' },
      { id: '2-2', name: 'coconut milk', quantity: 1, unit: 'can', category: 'Pantry' },
      { id: '2-3', name: 'baby spinach', quantity: 4, unit: 'cups', category: 'Produce' },
      { id: '2-4', name: 'yellow onion', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '2-5', name: 'curry powder', quantity: 2, unit: 'tbsp', category: 'Spices' },
      { id: '2-6', name: 'garlic', quantity: 3, unit: 'cloves', category: 'Produce' },
    ],
    steps: [
      { id: '2-s1', title: 'Build the base', body: 'Sauté onion and garlic with olive oil until fragrant.' },
      { id: '2-s2', title: 'Bloom spices', body: 'Stir in curry powder and toast for 30 seconds.' },
      { id: '2-s3', title: 'Simmer', body: 'Add chickpeas and coconut milk; simmer until thickened.', timerSeconds: 900 },
      { id: '2-s4', title: 'Finish', body: 'Fold in spinach and season with salt and lime juice.' },
    ],
    nutrition: { calories: 430, protein: '15g', carbs: '38g', fat: '24g' },
    attribution: 'Recipe Companion Kitchen',
  },
  {
    id: '3',
    title: 'Sheet Pan Lemon Herb Chicken',
    summary: 'Roasted chicken thighs with potatoes and green beans on one pan.',
    cuisine: 'American',
    diet: ['High Protein'],
    allergens: [],
    totalMinutes: 45,
    difficulty: 'Medium',
    servings: 4,
    heroColor: '#e0f2fe',
    tags: ['Family dinner', 'Hands-off', 'Crisp vegetables'],
    ingredients: [
      { id: '3-1', name: 'chicken thighs', quantity: 6, unit: 'pieces', category: 'Protein' },
      { id: '3-2', name: 'baby potatoes', quantity: 1.5, unit: 'lb', category: 'Produce' },
      { id: '3-3', name: 'green beans', quantity: 12, unit: 'oz', category: 'Produce' },
      { id: '3-4', name: 'dijon mustard', quantity: 1, unit: 'tbsp', category: 'Pantry' },
      { id: '3-5', name: 'lemon', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '3-6', name: 'garlic powder', quantity: 1, unit: 'tsp', category: 'Spices' },
    ],
    steps: [
      { id: '3-s1', title: 'Preheat oven', body: 'Heat oven to 425°F and line a sheet pan.' },
      { id: '3-s2', title: 'Season', body: 'Toss chicken and vegetables with mustard, lemon, olive oil, and spices.' },
      { id: '3-s3', title: 'Roast', body: 'Roast until chicken is golden and potatoes are tender.', timerSeconds: 2100 },
      { id: '3-s4', title: 'Serve', body: 'Rest 5 minutes and serve with pan juices.' },
    ],
    nutrition: { calories: 610, protein: '41g', carbs: '27g', fat: '38g' },
    attribution: 'Recipe Companion Kitchen',
  },
  {
    id: '4',
    title: 'Mediterranean Quinoa Salad',
    summary: 'A crisp, make-ahead salad with quinoa, herbs, and salty feta.',
    cuisine: 'Mediterranean',
    diet: ['Vegetarian'],
    allergens: ['Dairy'],
    totalMinutes: 20,
    difficulty: 'Easy',
    servings: 4,
    heroColor: '#f0f9ff',
    tags: ['Lunch', 'Meal prep', 'Fresh'],
    ingredients: [
      { id: '4-1', name: 'quinoa', quantity: 1, unit: 'cup', category: 'Pantry' },
      { id: '4-2', name: 'cherry tomatoes', quantity: 2, unit: 'cups', category: 'Produce' },
      { id: '4-3', name: 'cucumber', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '4-4', name: 'feta', quantity: 0.5, unit: 'cup', category: 'Dairy' },
      { id: '4-5', name: 'parsley', quantity: 1, unit: 'bunch', category: 'Produce' },
      { id: '4-6', name: 'red wine vinegar', quantity: 2, unit: 'tbsp', category: 'Pantry' },
    ],
    steps: [
      { id: '4-s1', title: 'Cook quinoa', body: 'Cook quinoa until fluffy and let cool.' },
      { id: '4-s2', title: 'Chop vegetables', body: 'Dice cucumber, halve tomatoes, and chop parsley.' },
      { id: '4-s3', title: 'Dress salad', body: 'Whisk olive oil, vinegar, salt, and pepper.' },
      { id: '4-s4', title: 'Combine', body: 'Toss everything together and fold in feta before serving.' },
    ],
    nutrition: { calories: 310, protein: '10g', carbs: '29g', fat: '17g' },
    attribution: 'Recipe Companion Kitchen',
  },
];

const defaultState: AppState = {
  recipes: seedRecipes,
  favorites: ['1'],
  collections: [
    { id: 'c1', name: 'Weeknight Winners', recipeIds: ['1', '2'] },
    { id: 'c2', name: 'Meal Prep', recipeIds: ['4'] },
  ],
  groceryItems: [],
  preferences: {
    diets: ['High Protein'],
    allergens: [],
    quickFilters: ['Weeknight', 'Meal prep'],
  },
  profile: {
    fullName: 'Taylor Chef',
    email: 'taylor@example.com',
    analyticsEnabled: true,
    onboardingCompleted: false,
  },
  cookingProgress: {},
  analyticsQueue: [],
  authToken: undefined,
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'COMPLETE_ONBOARDING':
      return {
        ...state,
        preferences: action.payload.preferences,
        profile: {
          ...state.profile,
          ...action.payload.profile,
          onboardingCompleted: true,
        },
      };
    case 'SIGN_IN':
      return {
        ...state,
        profile: {
          ...state.profile,
          fullName: action.payload.fullName,
          email: action.payload.email,
        },
        authToken: action.payload.authToken,
      };
    case 'SIGN_OUT':
      return {
        ...state,
        authToken: undefined,
      };
    case 'TOGGLE_FAVORITE':
      return {
        ...state,
        favorites: state.favorites.includes(action.payload.recipeId)
          ? state.favorites.filter((recipeId) => recipeId !== action.payload.recipeId)
          : [...state.favorites, action.payload.recipeId],
      };
    case 'CREATE_COLLECTION':
      return {
        ...state,
        collections: [
          ...state.collections,
          {
            id: `collection-${Date.now()}`,
            name: action.payload.name,
            recipeIds: action.payload.recipeIds,
          },
        ],
      };
    case 'UPDATE_COLLECTION':
      return {
        ...state,
        collections: state.collections.map((collection) =>
          collection.id === action.payload.id ? action.payload : collection
        ),
      };
    case 'DELETE_COLLECTION':
      return {
        ...state,
        collections: state.collections.filter(
          (collection) => collection.id !== action.payload.collectionId
        ),
      };
    case 'SET_GROCERY_ITEMS':
      return {
        ...state,
        groceryItems: action.payload,
      };
    case 'TOGGLE_GROCERY_ITEM':
      return {
        ...state,
        groceryItems: state.groceryItems.map((item) =>
          item.id === action.payload.itemId ? { ...item, checked: !item.checked } : item
        ),
      };
    case 'UPDATE_PROFILE':
      return {
        ...state,
        profile: {
          ...state.profile,
          ...action.payload,
        },
      };
    case 'MARK_STEP_COMPLETE': {
      const currentRecipeProgress = state.cookingProgress[action.payload.recipeId] ?? {
        completedStepIds: [],
      };
      const isAlreadyCompleted = currentRecipeProgress.completedStepIds.includes(action.payload.stepId);
      return {
        ...state,
        cookingProgress: {
          ...state.cookingProgress,
          [action.payload.recipeId]: {
            completedStepIds: isAlreadyCompleted
              ? currentRecipeProgress.completedStepIds
              : [...currentRecipeProgress.completedStepIds, action.payload.stepId],
          },
        },
      };
    }
    case 'CLEAR_USER_DATA':
      return {
        ...defaultState,
        profile: {
          ...defaultState.profile,
          onboardingCompleted: false,
          fullName: '',
          email: '',
        },
        favorites: [],
        collections: [],
        groceryItems: [],
        analyticsQueue: [],
        authToken: undefined,
      };
    case 'QUEUE_ANALYTICS':
      return {
        ...state,
        analyticsQueue: [...state.analyticsQueue, action.payload],
      };
    case 'CLEAR_ANALYTICS_QUEUE':
      return {
        ...state,
        analyticsQueue: [],
      };
    default:
      return state;
  }
}

// PUBLIC_INTERFACE
function App(): React.JSX.Element {
  /**
   * Main application entrypoint.
   * Returns the fully wired Recipe Companion mobile experience with providers, navigation, and stateful flows.
   */
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator(): React.JSX.Element {
  const { state, isHydrated } = useAppContext();

  if (!isHydrated) {
    return (
      <ScreenContainer>
        <CenteredState
          icon="restaurant-outline"
          title="Preparing your recipe space"
          description="Loading offline recipes, preferences, and collections."
        />
      </ScreenContainer>
    );
  }

  return (
    <>
      {!state.profile.onboardingCompleted ? <OnboardingModal /> : null}
      {!state.authToken ? <AuthModal /> : null}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Shell" component={TabNavigator} />
        <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
        <Stack.Screen name="CookingMode" component={CookingModeScreen} />
      </Stack.Navigator>
    </>
  );
}

function TabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: APP_THEME.colors.primary,
        tabBarInactiveTintColor: APP_THEME.colors.secondary,
        tabBarStyle: {
          backgroundColor: APP_THEME.colors.surface,
          borderTopColor: APP_THEME.colors.border,
          height: 68,
          paddingBottom: 10,
          paddingTop: 10,
        },
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
            Home: 'home-outline',
            Search: 'search-outline',
            Favorites: 'heart-outline',
            Grocery: 'basket-outline',
            Profile: 'person-outline',
          };
          return <Ionicons name={iconMap[route.name as keyof TabParamList]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} options={{ title: 'Saved' }} />
      <Tab.Screen name="Grocery" component={GroceryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AppStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, defaultState);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async (): Promise<void> => {
      try {
        const database = await SQLite.openDatabaseAsync('recipe-companion.db');
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
          );
        `);
        const stored = await database.getFirstAsync<{ value: string }>(
          'SELECT value FROM kv_store WHERE key = ?',
          [STORAGE_KEYS.appState]
        );
        const storedToken = await SecureStore.getItemAsync(STORAGE_KEYS.authToken);
        if (stored?.value) {
          const parsed = JSON.parse(stored.value) as AppState;
          if (isMounted) {
            dispatch({
              type: 'HYDRATE',
              payload: {
                ...defaultState,
                ...parsed,
                authToken: storedToken ?? parsed.authToken,
                recipes: parsed.recipes?.length ? parsed.recipes : seedRecipes,
              },
            });
          }
        } else if (storedToken && isMounted) {
          dispatch({
            type: 'HYDRATE',
            payload: {
              ...defaultState,
              authToken: storedToken,
              profile: {
                ...defaultState.profile,
                onboardingCompleted: false,
              },
            },
          });
        }
      } catch (error) {
        console.warn('Failed to hydrate local app state', error);
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const persist = async (): Promise<void> => {
      try {
        const database = await SQLite.openDatabaseAsync('recipe-companion.db');
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
          );
        `);
        await database.runAsync(
          'INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)',
          STORAGE_KEYS.appState,
          JSON.stringify(state)
        );
        if (state.authToken) {
          await SecureStore.setItemAsync(STORAGE_KEYS.authToken, state.authToken);
        } else {
          await SecureStore.deleteItemAsync(STORAGE_KEYS.authToken);
        }
      } catch (error) {
        console.warn('Failed to persist local app state', error);
      }
    };

    void persist();
  }, [state, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    void trackAnalyticsBatch(state.analyticsQueue, state.profile.analyticsEnabled).then(() => {
      if (state.analyticsQueue.length) {
        dispatch({ type: 'CLEAR_ANALYTICS_QUEUE' });
      }
    });
  }, [state.analyticsQueue, state.profile.analyticsEnabled, isHydrated]);

  const recipeMap = useMemo(
    () => new Map(state.recipes.map((recipe) => [recipe.id, recipe])),
    [state.recipes]
  );

  const recommendedRecipes = useMemo(() => {
    const matchedDiets = state.preferences.diets;
    return state.recipes
      .filter(
        (recipe) =>
          matchedDiets.length === 0 ||
          recipe.diet.some((dietTag) => matchedDiets.includes(dietTag))
      )
      .slice(0, 3);
  }, [state.preferences.diets, state.recipes]);

  const trackEvent = useCallback(
    async (name: AnalyticsEventName, payload: Record<string, unknown>) => {
      dispatch({
        type: 'QUEUE_ANALYTICS',
        payload: {
          name,
          payload,
          timestamp: new Date().toISOString(),
        },
      });
    },
    []
  );

  useEffect(() => {
    if (isHydrated) {
      void trackEvent('app_open', { platform: Platform.OS });
    }
  }, [isHydrated, trackEvent]);

  const searchRecipes = useCallback(
    async (params: SearchFilters): Promise<Recipe[]> => {
      const localResults = runLocalRecipeSearch(state.recipes, params);

      try {
        const apiResults = await fetchRecipeSearchFromApi(params);
        if (apiResults.length === 0) {
          return localResults;
        }
        const merged = mergeRemoteRecipeSummaries(localResults, apiResults);
        return runLocalRecipeSearch(merged, params);
      } catch (error) {
        console.warn('Recipe search fell back to local data', error);
        return localResults;
      }
    },
    [state.recipes]
  );

  const toggleFavorite = useCallback(
    (recipeId: string) => {
      dispatch({ type: 'TOGGLE_FAVORITE', payload: { recipeId } });
      void trackEvent('recipe_saved', { recipeId });
    },
    [trackEvent]
  );

  const createCollection = useCallback(
    (name: string, recipeIds: string[]) => {
      dispatch({ type: 'CREATE_COLLECTION', payload: { name, recipeIds } });
      void trackEvent('collection_created', { name, recipeCount: recipeIds.length });
    },
    [trackEvent]
  );

  const updateCollection = useCallback((collection: Collection) => {
    dispatch({ type: 'UPDATE_COLLECTION', payload: collection });
  }, []);

  const deleteCollection = useCallback((collectionId: string) => {
    dispatch({ type: 'DELETE_COLLECTION', payload: { collectionId } });
  }, []);

  const generateGroceryList = useCallback(
    (recipeIds: string[]) => {
      const items = normalizeGroceryItems(
        recipeIds
          .map((recipeId) => recipeMap.get(recipeId))
          .filter((recipe): recipe is Recipe => Boolean(recipe))
      );
      dispatch({ type: 'SET_GROCERY_ITEMS', payload: items });
      void trackEvent('grocery_generated', { recipeIds, itemCount: items.length });
    },
    [recipeMap, trackEvent]
  );

  const toggleGroceryItem = useCallback((itemId: string) => {
    dispatch({ type: 'TOGGLE_GROCERY_ITEM', payload: { itemId } });
  }, []);

  const completeOnboarding = useCallback(
    (preferences: UserPreferences, profile: Partial<UserProfile>) => {
      dispatch({ type: 'COMPLETE_ONBOARDING', payload: { preferences, profile } });
      void trackEvent('onboarding_completed', {
        diets: preferences.diets,
        allergens: preferences.allergens,
      });
    },
    [trackEvent]
  );

  const signIn = useCallback(
    async (mode: 'email' | 'google' | 'apple', email: string, password?: string) => {
      const response = await signInViaApi(mode, email, password);
      dispatch({
        type: 'SIGN_IN',
        payload: {
          email: response.email,
          fullName: response.fullName,
          authToken: response.token,
        },
      });
      await trackEvent('auth_signed_in', { mode });
    },
    [trackEvent]
  );

  const signOut = useCallback(async () => {
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  const markStepComplete = useCallback((recipeId: string, stepId: string) => {
    dispatch({ type: 'MARK_STEP_COMPLETE', payload: { recipeId, stepId } });
  }, []);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    dispatch({ type: 'UPDATE_PROFILE', payload: patch });
  }, []);

  const exportPrivacyData = useCallback(async (): Promise<string> => {
    const exportPayload = JSON.stringify(state, null, 2);
    await trackEvent('privacy_export_requested', { bytes: exportPayload.length });
    return exportPayload;
  }, [state, trackEvent]);

  const deletePrivacyData = useCallback(async (): Promise<void> => {
    dispatch({ type: 'CLEAR_USER_DATA' });
    await trackEvent('privacy_delete_requested', {});
  }, [trackEvent]);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      recipeMap,
      recommendedRecipes,
      searchRecipes,
      getRecipeById: (recipeId: string) => recipeMap.get(recipeId),
      toggleFavorite,
      createCollection,
      updateCollection,
      deleteCollection,
      generateGroceryList,
      toggleGroceryItem,
      completeOnboarding,
      signIn,
      signOut,
      markStepComplete,
      updateProfile,
      exportPrivacyData,
      deletePrivacyData,
      trackEvent,
      isHydrated,
    }),
    [
      state,
      recipeMap,
      recommendedRecipes,
      searchRecipes,
      toggleFavorite,
      createCollection,
      updateCollection,
      deleteCollection,
      generateGroceryList,
      toggleGroceryItem,
      completeOnboarding,
      signIn,
      signOut,
      markStepComplete,
      updateProfile,
      exportPrivacyData,
      deletePrivacyData,
      trackEvent,
      isHydrated,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// PUBLIC_INTERFACE
function useAppContext(): AppContextValue {
  /** Returns the shared app flow context for screens and reusable UI components. */
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppStateProvider');
  }
  return context;
}

function ScreenContainer({
  children,
  scroll = false,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}): React.JSX.Element {
  const content = scroll ? (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.scrollContent, !padded ? { paddingHorizontal: 0 } : undefined]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screen, padded ? styles.screenPadding : undefined]}>{children}</View>
  );

  return <SafeAreaView style={styles.safeArea}>{content}</SafeAreaView>;
}

function SectionHeader({
  title,
  actionLabel,
  onActionPress,
}: {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable accessibilityRole="button" onPress={onActionPress}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : undefined]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : undefined]}>{label}</Text>
    </Pressable>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}): React.JSX.Element {
  return <View style={[styles.card, style]}>{children}</View>;
}

function HeroBanner(): React.JSX.Element {
  const { state } = useAppContext();
  const firstName = state.profile.fullName.split(' ')[0] || 'Chef';
  return (
    <View
      style={styles.heroBanner}
      accessible
      accessibilityLabel={`Welcome back ${firstName}. Explore personalized recipe recommendations.`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.heroEyebrow}>Recipe Companion</Text>
        <Text style={styles.heroTitle}>Welcome back, {firstName}</Text>
        <Text style={styles.heroSubtitle}>
          Fresh recipes, saved collections, and your grocery plan are ready offline.
        </Text>
      </View>
      <View style={styles.heroBadge}>
        <Ionicons name="sparkles-outline" size={22} color={APP_THEME.colors.primary} />
        <Text style={styles.heroBadgeText}>Smart picks</Text>
      </View>
    </View>
  );
}

function RecipeCard({
  recipe,
  showFavorite = true,
  onPress,
}: {
  recipe: Recipe;
  showFavorite?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const { state, toggleFavorite } = useAppContext();
  const isFavorite = state.favorites.includes(recipe.id);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open recipe ${recipe.title}`}
      onPress={onPress}
      style={[styles.card, styles.recipeCard]}
    >
      <View style={[styles.recipeImagePlaceholder, { backgroundColor: recipe.heroColor }]}>
        <Ionicons name="restaurant-outline" size={28} color={APP_THEME.colors.primary} />
      </View>
      <View style={styles.recipeCardBody}>
        <View style={styles.recipeCardHeader}>
          <Text style={styles.recipeTitle}>{recipe.title}</Text>
          {showFavorite ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
              accessibilityState={{ selected: isFavorite }}
              onPress={() => toggleFavorite(recipe.id)}
              hitSlop={8}
            >
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={22}
                color={isFavorite ? APP_THEME.colors.error : APP_THEME.colors.secondary}
              />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.recipeSummary}>{recipe.summary}</Text>
        <View style={styles.metaRow}>
          <MetaPill icon="time-outline" label={`${recipe.totalMinutes} min`} />
          <MetaPill icon="flame-outline" label={recipe.difficulty} />
          <MetaPill icon="leaf-outline" label={recipe.cuisine} />
        </View>
        <View style={styles.chipRow}>
          {recipe.tags.slice(0, 3).map((tag) => (
            <Chip key={`${recipe.id}-${tag}`} label={tag} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

function MetaPill({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}): React.JSX.Element {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={14} color={APP_THEME.colors.secondary} />
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

function HomeScreen(): React.JSX.Element {
  const { recommendedRecipes, state, generateGroceryList } = useAppContext();
  const navigation = useNavigation();
  const [selectedQuickFilter, setSelectedQuickFilter] = useState<string | null>(null);

  const quickFilterResults = useMemo(() => {
    if (!selectedQuickFilter) {
      return recommendedRecipes;
    }
    return state.recipes.filter((recipe) => recipe.tags.includes(selectedQuickFilter));
  }, [selectedQuickFilter, recommendedRecipes, state.recipes]);

  return (
    <ScreenContainer scroll>
      <HeroBanner />
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Quick filters" />
        <View style={styles.chipRowWrap}>
          {state.preferences.quickFilters.map((filter) => (
            <Chip
              key={filter}
              label={filter}
              active={selectedQuickFilter === filter}
              onPress={() => setSelectedQuickFilter(selectedQuickFilter === filter ? null : filter)}
            />
          ))}
        </View>
      </View>
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Recommended for you" actionLabel="Build grocery list" onActionPress={() => generateGroceryList(recommendedRecipes.map((recipe) => recipe.id))} />
        {quickFilterResults.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onPress={() =>
              navigation.navigate('RecipeDetail' as never, { recipeId: recipe.id } as never)
            }
          />
        ))}
      </View>
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Saved this week" />
        <Card>
          <View style={styles.statRow}>
            <StatTile label="Favorites" value={`${state.favorites.length}`} icon="heart-outline" />
            <StatTile label="Collections" value={`${state.collections.length}`} icon="albums-outline" />
            <StatTile label="Groceries" value={`${state.groceryItems.length}`} icon="basket-outline" />
          </View>
        </Card>
      </View>
    </ScreenContainer>
  );
}

function SearchScreen(): React.JSX.Element {
  const { searchRecipes, state } = useAppContext();
  const navigation = useNavigation();
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    diets: [],
    allergens: [],
    difficulty: 'Any',
  });
  const [results, setResults] = useState<Recipe[]>(state.recipes);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const runSearch = async (): Promise<void> => {
      setLoading(true);
      const nextResults = await searchRecipes(filters);
      if (isMounted) {
        setResults(nextResults);
        setLoading(false);
      }
    };

    void runSearch();

    return () => {
      isMounted = false;
    };
  }, [filters, searchRecipes]);

  return (
    <ScreenContainer scroll>
      <Card>
        <Text style={styles.inputLabel}>Search recipes, cuisines, or ingredients</Text>
        <TextInput
          accessibilityLabel="Search recipes"
          placeholder="Try salmon, curry, or Mediterranean"
          placeholderTextColor={APP_THEME.colors.muted}
          style={styles.input}
          value={filters.query}
          onChangeText={(query) => setFilters((current) => ({ ...current, query }))}
        />
        <Text style={styles.inputLabel}>Diet</Text>
        <View style={styles.chipRowWrap}>
          {['Vegetarian', 'High Protein', 'Gluten Free', 'Dairy Free'].map((diet) => (
            <Chip
              key={diet}
              label={diet}
              active={filters.diets.includes(diet)}
              onPress={() =>
                setFilters((current) => ({
                  ...current,
                  diets: current.diets.includes(diet)
                    ? current.diets.filter((item) => item !== diet)
                    : [...current.diets, diet],
                }))
              }
            />
          ))}
        </View>
        <Text style={styles.inputLabel}>Difficulty</Text>
        <View style={styles.chipRowWrap}>
          {(['Any', 'Easy', 'Medium', 'Hard'] as const).map((difficulty) => (
            <Chip
              key={difficulty}
              label={difficulty}
              active={filters.difficulty === difficulty}
              onPress={() => setFilters((current) => ({ ...current, difficulty }))}
            />
          ))}
        </View>
        <Text style={styles.inputLabel}>Max minutes</Text>
        <TextInput
          accessibilityLabel="Maximum recipe duration in minutes"
          placeholder="30"
          placeholderTextColor={APP_THEME.colors.muted}
          keyboardType="numeric"
          style={styles.input}
          value={filters.maxMinutes ? String(filters.maxMinutes) : ''}
          onChangeText={(value) =>
            setFilters((current) => ({
              ...current,
              maxMinutes: value ? Number(value) : undefined,
            }))
          }
        />
      </Card>

      <View style={styles.sectionSpacing}>
        <SectionHeader title={loading ? 'Searching…' : `Results (${results.length})`} />
        {loading ? (
          <ActivityIndicator color={APP_THEME.colors.primary} />
        ) : results.length > 0 ? (
          results.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onPress={() =>
                navigation.navigate('RecipeDetail' as never, { recipeId: recipe.id } as never)
              }
            />
          ))
        ) : (
          <CenteredState
            icon="search-outline"
            title="No recipes match yet"
            description="Try clearing a filter or searching with a broader ingredient."
          />
        )}
      </View>
    </ScreenContainer>
  );
}

function FavoritesScreen(): React.JSX.Element {
  const { state, recipeMap, createCollection, deleteCollection, generateGroceryList } = useAppContext();
  const navigation = useNavigation();
  const [collectionName, setCollectionName] = useState('');

  const favoriteRecipes = state.favorites
    .map((recipeId) => recipeMap.get(recipeId))
    .filter((recipe): recipe is Recipe => Boolean(recipe));

  return (
    <ScreenContainer scroll>
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Favorites" actionLabel="Groceries" onActionPress={() => generateGroceryList(state.favorites)} />
        {favoriteRecipes.length ? (
          favoriteRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onPress={() =>
                navigation.navigate('RecipeDetail' as never, { recipeId: recipe.id } as never)
              }
            />
          ))
        ) : (
          <CenteredState
            icon="heart-outline"
            title="Save recipes to revisit"
            description="Favorites sync locally so your offline recipes are always available."
          />
        )}
      </View>
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Collections" />
        <Card>
          <Text style={styles.inputLabel}>Create a collection</Text>
          <TextInput
            accessibilityLabel="Collection name"
            value={collectionName}
            onChangeText={setCollectionName}
            placeholder="Weekend cooking"
            placeholderTextColor={APP_THEME.colors.muted}
            style={styles.input}
          />
          <PrimaryButton
            label="Create from favorites"
            onPress={() => {
              if (!collectionName.trim()) {
                Alert.alert('Collection name required', 'Please enter a name for the collection.');
                return;
              }
              createCollection(collectionName.trim(), state.favorites);
              setCollectionName('');
            }}
          />
        </Card>
        {state.collections.map((collection) => (
          <Card key={collection.id}>
            <View style={styles.collectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.collectionTitle}>{collection.name}</Text>
                <Text style={styles.collectionMeta}>{collection.recipeIds.length} saved recipes</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete collection ${collection.name}`}
                onPress={() => deleteCollection(collection.id)}
              >
                <Ionicons name="trash-outline" size={20} color={APP_THEME.colors.error} />
              </Pressable>
            </View>
            <View style={styles.chipRowWrap}>
              {collection.recipeIds.slice(0, 4).map((recipeId) => {
                const recipe = recipeMap.get(recipeId);
                return recipe ? <Chip key={`${collection.id}-${recipeId}`} label={recipe.title} /> : null;
              })}
            </View>
          </Card>
        ))}
      </View>
    </ScreenContainer>
  );
}

function GroceryScreen(): React.JSX.Element {
  const { state, toggleGroceryItem, generateGroceryList, favorites, recipeMap } = {
    ...useAppContext(),
    favorites: useAppContext().state.favorites,
  };

  const groupedItems = useMemo(() => {
    return state.groceryItems.reduce<Record<GroceryCategory, GroceryItem[]>>((accumulator, item) => {
      if (!accumulator[item.category]) {
        accumulator[item.category] = [];
      }
      accumulator[item.category].push(item);
      return accumulator;
    }, {} as Record<GroceryCategory, GroceryItem[]>);
  }, [state.groceryItems]);

  const shareList = async (): Promise<void> => {
    const body = Object.entries(groupedItems)
      .map(
        ([category, items]) =>
          `${category}\n${items
            .map((item) => `• ${item.amount} ${item.label}${item.checked ? ' ✓' : ''}`)
            .join('\n')}`
      )
      .join('\n\n');

    if (await Sharing.isAvailableAsync()) {
      await Share.share({ message: body });
    } else {
      await Share.share({ message: body });
    }
  };

  return (
    <ScreenContainer scroll>
      <Card>
        <Text style={styles.sectionTitle}>Smart grocery list</Text>
        <Text style={styles.cardDescription}>
          Generate a deduplicated list from your favorites or collections. Items are grouped by aisle and stored offline.
        </Text>
        <PrimaryButton
          label="Generate from favorites"
          onPress={() => generateGroceryList(favorites)}
        />
      </Card>
      <View style={styles.sectionSpacing}>
        <SectionHeader
          title={`Items (${state.groceryItems.length})`}
          actionLabel={state.groceryItems.length ? 'Share' : undefined}
          onActionPress={state.groceryItems.length ? shareList : undefined}
        />
        {state.groceryItems.length === 0 ? (
          <CenteredState
            icon="basket-outline"
            title="Your grocery list is empty"
            description="Build one from favorites or a collection to get started."
          />
        ) : (
          Object.entries(groupedItems).map(([category, items]) => (
            <Card key={category}>
              <Text style={styles.collectionTitle}>{category}</Text>
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.checked }}
                  onPress={() => toggleGroceryItem(item.id)}
                  style={styles.groceryRow}
                >
                  <Ionicons
                    name={item.checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={item.checked ? APP_THEME.colors.accent : APP_THEME.colors.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.groceryLabel, item.checked ? styles.groceryChecked : undefined]}>
                      {item.label}
                    </Text>
                    <Text style={styles.groceryMeta}>{item.amount}</Text>
                  </View>
                </Pressable>
              ))}
            </Card>
          ))
        )}
      </View>
      <View style={styles.sectionSpacing}>
        <SectionHeader title="Suggested sources" />
        {favorites.map((recipeId) => {
          const recipe = recipeMap.get(recipeId);
          return recipe ? <Chip key={`grocery-recipe-${recipeId}`} label={recipe.title} /> : null;
        })}
      </View>
    </ScreenContainer>
  );
}

function ProfileScreen(): React.JSX.Element {
  const { state, signOut, updateProfile, exportPrivacyData, deletePrivacyData } = useAppContext();
  const { fontScale } = useWindowDimensions();

  return (
    <ScreenContainer scroll>
      <Card>
        <View style={styles.profileHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {(state.profile.fullName || 'RC')
                .split(' ')
                .map((part) => part[0] ?? '')
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { fontSize: Math.max(24, 24 * fontScale * 0.8) }]}>
              {state.profile.fullName || 'Recipe Companion User'}
            </Text>
            <Text style={styles.profileEmail}>{state.profile.email || 'Add your email'}</Text>
          </View>
        </View>
      </Card>

      <View style={styles.sectionSpacing}>
        <SectionHeader title="Preferences" />
        <Card>
          <ProfileRow
            title="Analytics"
            description="Allow anonymous product analytics to improve recommendations."
            rightElement={
              <Switch
                accessibilityLabel="Enable analytics"
                value={state.profile.analyticsEnabled}
                onValueChange={(value) => updateProfile({ analyticsEnabled: value })}
              />
            }
          />
          <ProfileRow
            title="Dietary preferences"
            description={state.preferences.diets.join(', ') || 'No dietary preferences saved'}
          />
          <ProfileRow
            title="Allergens"
            description={state.preferences.allergens.join(', ') || 'No allergens saved'}
          />
        </Card>
      </View>

      <View style={styles.sectionSpacing}>
        <SectionHeader title="Privacy controls" />
        <Card>
          <PrimaryButton
            label="Export my data"
            variant="secondary"
            onPress={async () => {
              const payload = await exportPrivacyData();
              Alert.alert('Privacy export ready', payload.slice(0, 280) + (payload.length > 280 ? '…' : ''));
            }}
          />
          <PrimaryButton
            label="Delete local data"
            variant="ghost"
            onPress={() =>
              Alert.alert(
                'Delete account data?',
                'This clears local profile, favorites, collections, and grocery history from the device.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      void deletePrivacyData();
                    },
                  },
                ]
              )
            }
          />
        </Card>
      </View>

      <View style={styles.sectionSpacing}>
        <SectionHeader title="Account" />
        <Card>
          <PrimaryButton label="Sign out" variant="secondary" onPress={() => void signOut()} />
        </Card>
      </View>
    </ScreenContainer>
  );
}

function ProfileRow({
  title,
  description,
  rightElement,
}: {
  title: string;
  description: string;
  rightElement?: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.profileRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.profileRowTitle}>{title}</Text>
        <Text style={styles.profileRowDescription}>{description}</Text>
      </View>
      {rightElement}
    </View>
  );
}

function RecipeDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'RecipeDetail'>): React.JSX.Element {
  const { getRecipeById, state, toggleFavorite, trackEvent, generateGroceryList } = useAppContext();
  const recipe = getRecipeById(route.params.recipeId);
  const [servings, setServings] = useState(recipe?.servings ?? 1);

  useEffect(() => {
    if (recipe) {
      void trackEvent('recipe_opened', { recipeId: recipe.id });
    }
  }, [recipe, trackEvent]);

  if (!recipe) {
    return (
      <ScreenContainer>
        <CenteredState
          icon="alert-circle-outline"
          title="Recipe unavailable"
          description="The recipe could not be found in local storage."
        />
      </ScreenContainer>
    );
  }

  const servingMultiplier = servings / recipe.servings;
  const isFavorite = state.favorites.includes(recipe.id);

  return (
    <ScreenContainer scroll>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={[styles.detailHero, { backgroundColor: recipe.heroColor }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back-outline" size={22} color={APP_THEME.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onPress={() => toggleFavorite(recipe.id)}
            style={styles.favoriteButton}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={22}
              color={isFavorite ? APP_THEME.colors.error : APP_THEME.colors.text}
            />
          </Pressable>
          <View style={styles.detailHeroContent}>
            <Text style={styles.detailTitle}>{recipe.title}</Text>
            <Text style={styles.detailSubtitle}>{recipe.summary}</Text>
            <View style={styles.metaRow}>
              <MetaPill icon="time-outline" label={`${recipe.totalMinutes} min`} />
              <MetaPill icon="people-outline" label={`${servings} servings`} />
              <MetaPill icon="flame-outline" label={recipe.difficulty} />
            </View>
          </View>
        </View>
      </Card>

      <View style={styles.sectionSpacing}>
        <SectionHeader title="Ingredients" actionLabel="Groceries" onActionPress={() => generateGroceryList([recipe.id])} />
        <Card>
          <View style={styles.servingsRow}>
            <Text style={styles.profileRowTitle}>Adjust servings</Text>
            <View style={styles.servingAdjuster}>
              <Pressable onPress={() => setServings((current) => Math.max(1, current - 1))} style={styles.servingButton}>
                <Ionicons name="remove" size={18} color={APP_THEME.colors.text} />
              </Pressable>
              <Text style={styles.servingsCount}>{servings}</Text>
              <Pressable onPress={() => setServings((current) => current + 1)} style={styles.servingButton}>
                <Ionicons name="add" size={18} color={APP_THEME.colors.text} />
              </Pressable>
            </View>
          </View>
          {recipe.ingredients.map((ingredient) => (
            <View key={ingredient.id} style={styles.ingredientRow}>
              <Ionicons name="checkmark-done-outline" size={16} color={APP_THEME.colors.accent} />
              <Text style={styles.ingredientText}>
                {formatQuantity(ingredient.quantity * servingMultiplier)} {ingredient.unit} {ingredient.name}
              </Text>
            </View>
          ))}
        </Card>
      </View>

      <View style={styles.sectionSpacing}>
        <SectionHeader title="Steps" />
        {recipe.steps.map((step, index) => (
          <Card key={step.id}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepNumber}>Step {index + 1}</Text>
              {step.timerSeconds ? <Chip label={`${Math.round(step.timerSeconds / 60)} min timer`} /> : null}
            </View>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </Card>
        ))}
        <PrimaryButton
          label="Start cooking mode"
          onPress={() => navigation.navigate('CookingMode', { recipeId: recipe.id })}
        />
      </View>

      {recipe.nutrition ? (
        <View style={styles.sectionSpacing}>
          <SectionHeader title="Nutrition" />
          <Card>
            <View style={styles.statRow}>
              <StatTile label="Calories" value={`${recipe.nutrition.calories}`} icon="nutrition-outline" />
              <StatTile label="Protein" value={recipe.nutrition.protein} icon="barbell-outline" />
              <StatTile label="Carbs" value={recipe.nutrition.carbs} icon="leaf-outline" />
              <StatTile label="Fat" value={recipe.nutrition.fat} icon="water-outline" />
            </View>
          </Card>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

function CookingModeScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'CookingMode'>): React.JSX.Element {
  useKeepAwake();
  const { getRecipeById, state, markStepComplete, trackEvent } = useAppContext();
  const recipe = getRecipeById(route.params.recipeId);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (recipe) {
      void trackEvent('cooking_started', { recipeId: recipe.id });
    }
  }, [recipe, trackEvent]);

  if (!recipe) {
    return (
      <ScreenContainer>
        <CenteredState
          icon="alert-circle-outline"
          title="Cooking mode unavailable"
          description="This recipe is not available offline right now."
        />
      </ScreenContainer>
    );
  }

  const currentStep = recipe.steps[stepIndex];
  const completedStepIds = state.cookingProgress[recipe.id]?.completedStepIds ?? [];

  return (
    <ScreenContainer>
      <Card style={styles.cookingModeCard}>
        <View style={styles.cookingTopBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Exit cooking mode" onPress={() => navigation.goBack()}>
            <Ionicons name="close-outline" size={28} color={APP_THEME.colors.text} />
          </Pressable>
          <Chip label={`${stepIndex + 1}/${recipe.steps.length}`} active />
        </View>
        <Text style={styles.cookingRecipeTitle}>{recipe.title}</Text>
        <Text style={styles.cookingStepLabel}>Current step</Text>
        <Text style={styles.cookingStepTitle}>{currentStep.title}</Text>
        <Text style={styles.cookingStepBody}>{currentStep.body}</Text>
        {currentStep.timerSeconds ? (
          <View style={styles.timerBox}>
            <Ionicons name="timer-outline" size={18} color={APP_THEME.colors.accent} />
            <Text style={styles.timerText}>
              Suggested timer: {Math.round(currentStep.timerSeconds / 60)} minutes
            </Text>
          </View>
        ) : null}
        <View style={styles.progressRow}>
          {recipe.steps.map((step) => (
            <View
              key={step.id}
              style={[
                styles.progressDot,
                completedStepIds.includes(step.id) || step.id === currentStep.id
                  ? styles.progressDotActive
                  : undefined,
              ]}
            />
          ))}
        </View>
        <View style={styles.cookingActions}>
          <PrimaryButton
            label="Mark complete"
            onPress={() => markStepComplete(recipe.id, currentStep.id)}
          />
          <PrimaryButton
            label={stepIndex < recipe.steps.length - 1 ? 'Next step' : 'Finish'}
            variant="secondary"
            onPress={() => {
              if (stepIndex < recipe.steps.length - 1) {
                setStepIndex((current) => current + 1);
              } else {
                navigation.goBack();
              }
            }}
          />
        </View>
      </Card>
    </ScreenContainer>
  );
}

function OnboardingModal(): React.JSX.Element {
  const { completeOnboarding, state } = useAppContext();
  const [selectedDiets, setSelectedDiets] = useState<string[]>(state.preferences.diets);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>(state.preferences.allergens);
  const [fullName, setFullName] = useState(state.profile.fullName);

  return (
    <Modal transparent animationType="slide" visible={!state.profile.onboardingCompleted}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text accessibilityRole="header" style={styles.modalTitle}>
            Set up your recipe experience
          </Text>
          <Text style={styles.modalDescription}>
            Tell us about your preferences so recommendations, search, and grocery planning feel personalized from day one.
          </Text>
          <Text style={styles.inputLabel}>Your name</Text>
          <TextInput
            accessibilityLabel="Your full name"
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Taylor Chef"
            placeholderTextColor={APP_THEME.colors.muted}
          />
          <Text style={styles.inputLabel}>Dietary preferences</Text>
          <View style={styles.chipRowWrap}>
            {['Vegetarian', 'High Protein', 'Gluten Free', 'Dairy Free'].map((diet) => (
              <Chip
                key={diet}
                label={diet}
                active={selectedDiets.includes(diet)}
                onPress={() =>
                  setSelectedDiets((current) =>
                    current.includes(diet)
                      ? current.filter((item) => item !== diet)
                      : [...current, diet]
                  )
                }
              />
            ))}
          </View>
          <Text style={styles.inputLabel}>Allergens</Text>
          <View style={styles.chipRowWrap}>
            {['Fish', 'Dairy', 'Egg', 'Peanut', 'Soy'].map((allergen) => (
              <Chip
                key={allergen}
                label={allergen}
                active={selectedAllergens.includes(allergen)}
                onPress={() =>
                  setSelectedAllergens((current) =>
                    current.includes(allergen)
                      ? current.filter((item) => item !== allergen)
                      : [...current, allergen]
                  )
                }
              />
            ))}
          </View>
          <PrimaryButton
            label="Continue"
            onPress={() =>
              completeOnboarding(
                {
                  diets: selectedDiets,
                  allergens: selectedAllergens,
                  quickFilters: ['Weeknight', 'Meal prep', 'Comforting'],
                },
                { fullName }
              )
            }
          />
        </View>
      </View>
    </Modal>
  );
}

function AuthModal(): React.JSX.Element {
  const { signIn } = useAppContext();
  const [email, setEmail] = useState('chef@example.com');
  const [password, setPassword] = useState('demo-password');
  const [loadingMode, setLoadingMode] = useState<'email' | 'google' | 'apple' | null>(null);

  const handleSignIn = async (mode: 'email' | 'google' | 'apple'): Promise<void> => {
    try {
      setLoadingMode(mode);
      await signIn(mode, email, password);
    } catch (error) {
      console.warn('Unable to complete sign-in', error);
      Alert.alert('Sign-in unavailable', 'The app will continue with an offline-ready local demo account.');
      await signIn(mode, email, password);
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text accessibilityRole="header" style={styles.modalTitle}>
            Sign in to sync your kitchen
          </Text>
          <Text style={styles.modalDescription}>
            Use email or continue with Apple or Google. The app remains usable offline for saved recipes.
          </Text>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={APP_THEME.colors.muted}
          />
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={APP_THEME.colors.muted}
          />
          <PrimaryButton
            label={loadingMode === 'email' ? 'Signing in…' : 'Sign in with email'}
            onPress={() => void handleSignIn('email')}
          />
          <PrimaryButton
            label={loadingMode === 'google' ? 'Connecting…' : 'Continue with Google'}
            variant="secondary"
            onPress={() => void handleSignIn('google')}
          />
          <PrimaryButton
            label={loadingMode === 'apple' ? 'Connecting…' : 'Continue with Apple'}
            variant="ghost"
            onPress={() => void handleSignIn('apple')}
          />
        </View>
      </View>
    </Modal>
  );
}

function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' ? styles.buttonSecondary : undefined,
        variant === 'ghost' ? styles.buttonGhost : undefined,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' ? styles.buttonTextSecondary : undefined,
          variant === 'ghost' ? styles.buttonTextGhost : undefined,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
}): React.JSX.Element {
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} size={18} color={APP_THEME.colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CenteredState({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <View style={styles.centeredState}>
      <Ionicons name={icon} size={36} color={APP_THEME.colors.primary} />
      <Text style={styles.centeredTitle}>{title}</Text>
      <Text style={styles.centeredDescription}>{description}</Text>
    </View>
  );
}

function runLocalRecipeSearch(recipes: Recipe[], filters: SearchFilters): Recipe[] {
  const query = filters.query.trim().toLowerCase();

  return recipes.filter((recipe) => {
    const matchesQuery =
      !query ||
      recipe.title.toLowerCase().includes(query) ||
      recipe.summary.toLowerCase().includes(query) ||
      recipe.cuisine.toLowerCase().includes(query) ||
      recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(query));

    const matchesDiet =
      filters.diets.length === 0 || filters.diets.every((diet) => recipe.diet.includes(diet));

    const matchesAllergens =
      filters.allergens.length === 0 ||
      filters.allergens.every((allergen) => !recipe.allergens.includes(allergen));

    const matchesMinutes =
      !filters.maxMinutes || recipe.totalMinutes <= filters.maxMinutes;

    const matchesDifficulty =
      !filters.difficulty || filters.difficulty === 'Any' || recipe.difficulty === filters.difficulty;

    return matchesQuery && matchesDiet && matchesAllergens && matchesMinutes && matchesDifficulty;
  });
}

function normalizeGroceryItems(recipes: Recipe[]): GroceryItem[] {
  const itemMap = new Map<string, GroceryItem>();

  recipes.forEach((recipe) => {
    recipe.ingredients.forEach((ingredient) => {
      const key = `${ingredient.name.toLowerCase()}-${ingredient.unit.toLowerCase()}`;
      const existing = itemMap.get(key);
      if (existing) {
        const currentAmount = Number(existing.amount.split(' ')[0]) || 0;
        existing.amount = `${formatQuantity(currentAmount + ingredient.quantity)} ${ingredient.unit}`;
        existing.sourceRecipeIds = Array.from(new Set([...existing.sourceRecipeIds, recipe.id]));
      } else {
        itemMap.set(key, {
          id: `${recipe.id}-${ingredient.id}`,
          label: ingredient.name,
          amount: `${formatQuantity(ingredient.quantity)} ${ingredient.unit}`,
          category: ingredient.category,
          checked: false,
          sourceRecipeIds: [recipe.id],
        });
      }
    });
  });

  return Array.from(itemMap.values()).sort((left, right) => left.category.localeCompare(right.category));
}

function formatQuantity(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

async function trackAnalyticsBatch(
  queue: AnalyticsEvent[],
  analyticsEnabled: boolean
): Promise<void> {
  if (!analyticsEnabled || queue.length === 0) {
    return;
  }

  const apiBaseUrl = getApiBaseUrl();
  try {
    await fetch(`${apiBaseUrl}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queue),
    });
  } catch (error) {
    console.warn('Analytics event delivery deferred to local queue only', error);
  }
}

function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/$/, '');
  }
  return 'http://localhost:3001';
}

async function fetchRecipeSearchFromApi(filters: SearchFilters): Promise<Recipe[]> {
  const apiBaseUrl = getApiBaseUrl();
  const params = new URLSearchParams();
  if (filters.query) {
    params.append('q', filters.query);
  }
  if (filters.diets.length) {
    params.append('diet', filters.diets.join(','));
  }
  if (filters.maxMinutes) {
    params.append('max_minutes', String(filters.maxMinutes));
  }
  if (filters.difficulty && filters.difficulty !== 'Any') {
    params.append('difficulty', filters.difficulty);
  }

  const response = await fetch(`${apiBaseUrl}/recipes/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Recipe search failed with status ${response.status}`);
  }

  const json = (await response.json()) as ApiRecipeSummary[] | { items?: ApiRecipeSummary[] };
  const summaries = Array.isArray(json) ? json : json.items ?? [];

  return summaries.map((summary, index) => ({
    ...seedRecipes[index % seedRecipes.length],
    id: summary.id || `remote-${index}`,
    title: summary.title || seedRecipes[index % seedRecipes.length].title,
    summary: summary.summary || seedRecipes[index % seedRecipes.length].summary,
    cuisine: summary.cuisine || seedRecipes[index % seedRecipes.length].cuisine,
  }));
}

function mergeRemoteRecipeSummaries(localResults: Recipe[], remoteResults: Recipe[]): Recipe[] {
  const merged = new Map<string, Recipe>();
  [...localResults, ...remoteResults].forEach((recipe) => {
    merged.set(recipe.id, recipe);
  });
  return Array.from(merged.values());
}

async function signInViaApi(
  mode: 'email' | 'google' | 'apple',
  email: string,
  password?: string
): Promise<{ email: string; fullName: string; token: string }> {
  const apiBaseUrl = getApiBaseUrl();
  const payload = {
    provider: mode,
    email,
    password,
  };

  try {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const json = (await response.json()) as {
        email?: string;
        full_name?: string;
        token?: string;
      };
      return {
        email: json.email ?? email,
        fullName: json.full_name ?? 'Recipe Companion User',
        token: json.token ?? `local-${mode}-token`,
      };
    }
  } catch (error) {
    console.warn('Auth API unavailable, using local fallback sign-in', error);
  }

  return {
    email,
    fullName: mode === 'email' ? 'Recipe Companion User' : `${mode[0].toUpperCase()}${mode.slice(1)} Chef`,
    token: `offline-${mode}-token`,
  };
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: APP_THEME.colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: APP_THEME.colors.background,
  },
  screenPadding: {
    paddingHorizontal: APP_THEME.spacing.lg,
    paddingVertical: APP_THEME.spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: APP_THEME.spacing.lg,
    paddingVertical: APP_THEME.spacing.lg,
    gap: APP_THEME.spacing.lg,
  },
  heroBanner: {
    backgroundColor: APP_THEME.colors.surface,
    borderRadius: APP_THEME.radius.lg,
    padding: APP_THEME.spacing.xl,
    flexDirection: 'row',
    gap: APP_THEME.spacing.lg,
    borderWidth: 1,
    borderColor: APP_THEME.colors.border,
  },
  heroEyebrow: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
    marginBottom: APP_THEME.spacing.sm,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: APP_THEME.colors.text,
    marginBottom: APP_THEME.spacing.sm,
  },
  heroSubtitle: {
    color: APP_THEME.colors.secondary,
    lineHeight: 22,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingVertical: APP_THEME.spacing.md,
    paddingHorizontal: APP_THEME.spacing.md,
    backgroundColor: APP_THEME.colors.heroBlue,
    borderRadius: APP_THEME.radius.md,
    alignItems: 'center',
    gap: APP_THEME.spacing.xs,
  },
  heroBadgeText: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
  },
  sectionSpacing: {
    gap: APP_THEME.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  sectionAction: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
  },
  card: {
    backgroundColor: APP_THEME.colors.surface,
    borderRadius: APP_THEME.radius.lg,
    padding: APP_THEME.spacing.lg,
    borderWidth: 1,
    borderColor: APP_THEME.colors.border,
    gap: APP_THEME.spacing.md,
  },
  recipeCard: {
    flexDirection: 'row',
  },
  recipeImagePlaceholder: {
    width: 92,
    height: 92,
    borderRadius: APP_THEME.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeCardBody: {
    flex: 1,
    gap: APP_THEME.spacing.sm,
  },
  recipeCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: APP_THEME.spacing.sm,
  },
  recipeTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  recipeSummary: {
    color: APP_THEME.colors.secondary,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: APP_THEME.spacing.sm,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: APP_THEME.spacing.xs,
    paddingHorizontal: APP_THEME.spacing.sm,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: APP_THEME.radius.pill,
  },
  metaLabel: {
    color: APP_THEME.colors.secondary,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.sm,
  },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: APP_THEME.spacing.sm,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: APP_THEME.radius.pill,
    backgroundColor: APP_THEME.colors.chip,
  },
  chipActive: {
    backgroundColor: APP_THEME.colors.primary,
  },
  chipText: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
  },
  chipTextActive: {
    color: APP_THEME.colors.surface,
  },
  statRow: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.md,
    flexWrap: 'wrap',
  },
  statTile: {
    flex: 1,
    minWidth: 90,
    backgroundColor: '#f8fafc',
    borderRadius: APP_THEME.radius.md,
    padding: APP_THEME.spacing.md,
    gap: APP_THEME.spacing.xs,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  statLabel: {
    color: APP_THEME.colors.secondary,
    fontSize: 12,
  },
  inputLabel: {
    fontWeight: '700',
    color: APP_THEME.colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: APP_THEME.colors.border,
    borderRadius: APP_THEME.radius.md,
    paddingHorizontal: APP_THEME.spacing.md,
    paddingVertical: APP_THEME.spacing.md,
    color: APP_THEME.colors.text,
    backgroundColor: '#ffffff',
  },
  centeredState: {
    paddingVertical: APP_THEME.spacing.xxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: APP_THEME.spacing.sm,
  },
  centeredTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: APP_THEME.colors.text,
    textAlign: 'center',
  },
  centeredDescription: {
    color: APP_THEME.colors.secondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: APP_THEME.spacing.md,
  },
  collectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  collectionMeta: {
    color: APP_THEME.colors.secondary,
  },
  groceryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: APP_THEME.spacing.md,
    paddingVertical: APP_THEME.spacing.sm,
  },
  groceryLabel: {
    fontSize: 16,
    color: APP_THEME.colors.text,
    fontWeight: '600',
  },
  groceryChecked: {
    textDecorationLine: 'line-through',
    color: APP_THEME.colors.secondary,
  },
  groceryMeta: {
    color: APP_THEME.colors.secondary,
    marginTop: 2,
  },
  cardDescription: {
    color: APP_THEME.colors.secondary,
    lineHeight: 22,
  },
  profileHeader: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.md,
    alignItems: 'center',
  },
  avatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: APP_THEME.colors.heroBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '800',
    fontSize: 24,
    color: APP_THEME.colors.primary,
  },
  profileName: {
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  profileEmail: {
    color: APP_THEME.colors.secondary,
    marginTop: 4,
  },
  profileRow: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.md,
    alignItems: 'center',
    paddingVertical: APP_THEME.spacing.sm,
  },
  profileRowTitle: {
    fontWeight: '700',
    color: APP_THEME.colors.text,
    marginBottom: 4,
  },
  profileRowDescription: {
    color: APP_THEME.colors.secondary,
    lineHeight: 20,
  },
  button: {
    backgroundColor: APP_THEME.colors.primary,
    borderRadius: APP_THEME.radius.md,
    paddingVertical: 14,
    paddingHorizontal: APP_THEME.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: APP_THEME.colors.heroBlue,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: APP_THEME.colors.border,
  },
  buttonText: {
    color: APP_THEME.colors.surface,
    fontWeight: '800',
    fontSize: 16,
  },
  buttonTextSecondary: {
    color: APP_THEME.colors.primary,
  },
  buttonTextGhost: {
    color: APP_THEME.colors.text,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'flex-end',
    padding: APP_THEME.spacing.lg,
  },
  modalSheet: {
    backgroundColor: APP_THEME.colors.surface,
    borderRadius: APP_THEME.radius.lg,
    padding: APP_THEME.spacing.xl,
    gap: APP_THEME.spacing.md,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  modalDescription: {
    color: APP_THEME.colors.secondary,
    lineHeight: 22,
  },
  detailHero: {
    minHeight: 220,
    padding: APP_THEME.spacing.xl,
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteButton: {
    position: 'absolute',
    right: APP_THEME.spacing.xl,
    top: APP_THEME.spacing.xl,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroContent: {
    gap: APP_THEME.spacing.sm,
  },
  detailTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: APP_THEME.colors.text,
    maxWidth: '85%',
  },
  detailSubtitle: {
    color: APP_THEME.colors.secondary,
    lineHeight: 22,
    maxWidth: '85%',
  },
  servingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  servingAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: APP_THEME.spacing.md,
  },
  servingButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: APP_THEME.colors.heroBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  servingsCount: {
    fontWeight: '800',
    fontSize: 18,
    color: APP_THEME.colors.text,
  },
  ingredientRow: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.sm,
    alignItems: 'center',
  },
  ingredientText: {
    color: APP_THEME.colors.text,
    flex: 1,
  },
  stepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepNumber: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: APP_THEME.colors.text,
  },
  stepBody: {
    color: APP_THEME.colors.secondary,
    lineHeight: 22,
  },
  cookingModeCard: {
    flex: 1,
    justifyContent: 'center',
  },
  cookingTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cookingRecipeTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: APP_THEME.colors.text,
  },
  cookingStepLabel: {
    color: APP_THEME.colors.primary,
    fontWeight: '700',
  },
  cookingStepTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: APP_THEME.colors.text,
  },
  cookingStepBody: {
    color: APP_THEME.colors.secondary,
    lineHeight: 24,
    fontSize: 16,
  },
  timerBox: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.sm,
    alignItems: 'center',
    backgroundColor: '#ecfeff',
    padding: APP_THEME.spacing.md,
    borderRadius: APP_THEME.radius.md,
  },
  timerText: {
    color: APP_THEME.colors.text,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    gap: APP_THEME.spacing.sm,
    justifyContent: 'center',
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: APP_THEME.colors.border,
  },
  progressDotActive: {
    backgroundColor: APP_THEME.colors.primary,
  },
  cookingActions: {
    gap: APP_THEME.spacing.md,
  },
});

export default App;
