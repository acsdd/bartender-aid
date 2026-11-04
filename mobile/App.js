import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';

const defaultHost = Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';
const API_URL = (process.env.EXPO_PUBLIC_API_URL || `${defaultHost}/api`).replace(/\/+$/, '');

const colors = {
  ink: '#18352D',
  muted: '#66736B',
  paper: '#F6F4EC',
  white: '#FFFFFF',
  line: '#DCE1D8',
  green: '#245B49',
  greenLight: '#E4EEE5',
  red: '#A64C3A',
};

export default function App() {
  const [ingredients, setIngredients] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [cocktails, setCocktails] = useState([]);
  const [fetchingIngredients, setFetchingIngredients] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [ingredientError, setIngredientError] = useState('');
  const [matchError, setMatchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadIngredients() {
      setFetchingIngredients(true);
      setIngredientError('');
      try {
        const response = await axios.get(`${API_URL}/ingredients`, { signal: controller.signal });
        setIngredients(response.data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setIngredientError('Could not reach the bar inventory. Check the API connection and try again.');
        }
      } finally {
        if (!controller.signal.aborted) setFetchingIngredients(false);
      }
    }

    loadIngredients();
    return () => controller.abort();
  }, [reloadKey]);

  const toggleIngredient = (id) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
    setCocktails([]);
    setHasSearched(false);
    setMatchError('');
  };

  const findCocktails = async () => {
    if (selectedIds.length === 0 || loadingMatches) return;
    setLoadingMatches(true);
    setMatchError('');
    setHasSearched(true);
    try {
      const response = await axios.post(`${API_URL}/match`, { ingredientIds: selectedIds });
      setCocktails(response.data);
    } catch (error) {
      setMatchError('Could not search recipes. Check the API connection and try again.');
    } finally {
      setLoadingMatches(false);
    }
  };

  const groupedIngredients = ingredients.reduce((groups, ingredient) => {
    const category = ingredient.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(ingredient);
    return groups;
  }, {});

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>BARTENDER AID</Text>
          <View style={styles.selectedCount}>
            <Text style={styles.selectedCountText}>{selectedIds.length} SELECTED</Text>
          </View>
        </View>

        <Text style={styles.title}>What's in your bar?</Text>
        <Text style={styles.subtitle}>Spirits, mixers, liqueurs and garnishes.</Text>

        <View style={styles.inventoryHeader}>
          <Text style={styles.sectionTitle}>Your inventory</Text>
          {!fetchingIngredients && !ingredientError && (
            <Text style={styles.itemCount}>{ingredients.length} ingredients</Text>
          )}
        </View>

        {fetchingIngredients ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={colors.green} />
            <Text style={styles.stateText}>Loading inventory...</Text>
          </View>
        ) : ingredientError ? (
          <View style={styles.statePanel}>
            <Text style={styles.errorText}>{ingredientError}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => setReloadKey((key) => key + 1)}>
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : ingredients.length === 0 ? (
          <View style={styles.statePanel}>
            <Text style={styles.stateText}>No ingredients are available yet.</Text>
          </View>
        ) : (
          Object.entries(groupedIngredients).map(([category, items]) => (
            <View key={category} style={styles.categoryBlock}>
              <Text style={styles.categoryLabel}>{category}</Text>
              <View style={styles.chipList}>
                {items.map((ingredient) => {
                  const isSelected = selectedIds.includes(ingredient.id);
                  return (
                    <Pressable
                      key={ingredient.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      onPress={() => toggleIngredient(ingredient.id)}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {ingredient.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}

        <Pressable
          accessibilityRole="button"
          onPress={findCocktails}
          disabled={selectedIds.length === 0 || loadingMatches || Boolean(ingredientError)}
          style={({ pressed }) => [
            styles.findButton,
            (selectedIds.length === 0 || Boolean(ingredientError)) && styles.findButtonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {loadingMatches ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.findButtonText}>Find recipes</Text>
          )}
        </Pressable>

        <View style={styles.resultsHeader}>
          <Text style={styles.sectionTitle}>Recipes</Text>
          {hasSearched && !matchError && (
            <Text style={styles.itemCount}>{cocktails.length} found</Text>
          )}
        </View>

        {matchError ? (
          <View style={styles.statePanel}>
            <Text style={styles.errorText}>{matchError}</Text>
            <Pressable style={styles.secondaryButton} onPress={findCocktails}>
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : hasSearched && !loadingMatches && cocktails.length === 0 ? (
          <View style={styles.statePanel}>
            <Text style={styles.stateText}>No complete recipes match this selection.</Text>
          </View>
        ) : (
          cocktails.map((cocktail) => (
            <View key={cocktail.id} style={styles.recipe}>
              {cocktail.image_url ? (
                <Image source={{ uri: cocktail.image_url }} style={styles.recipeImage} />
              ) : null}
              <View style={styles.recipeBody}>
                <View style={styles.recipeTopline}>
                  <Text style={styles.recipeTitle}>{cocktail.name}</Text>
                  {cocktail.glassware ? (
                    <Text style={styles.glassware}>{cocktail.glassware}</Text>
                  ) : null}
                </View>
                {Array.isArray(cocktail.ingredients) && (
                  <View style={styles.recipeIngredients}>
                    {cocktail.ingredients.map((ingredient) => (
                      <View key={ingredient.id} style={styles.recipeIngredient}>
                        <Text style={styles.ingredientAmount}>{ingredient.amount}</Text>
                        <Text style={styles.ingredientName}>{ingredient.name}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.instructions}>{cocktail.instructions}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  screen: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 44 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.green, fontSize: 12, fontWeight: '800' },
  selectedCount: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.greenLight, borderRadius: 4 },
  selectedCountText: { color: colors.green, fontSize: 10, fontWeight: '800' },
  title: { color: colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 34, lineHeight: 40, marginTop: 22 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 340 },
  inventoryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 30, marginBottom: 14 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  itemCount: { color: colors.muted, fontSize: 12 },
  categoryBlock: { marginBottom: 17 },
  categoryLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 9, textTransform: 'uppercase' },
  chipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 4, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 8 },
  chipSelected: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  chipTextSelected: { color: colors.white, fontWeight: '700' },
  findButton: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 5, justifyContent: 'center', marginTop: 5, minHeight: 52 },
  findButtonDisabled: { backgroundColor: '#A5B5AA' },
  findButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  buttonPressed: { opacity: 0.8 },
  resultsHeader: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13, marginTop: 30 },
  statePanel: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 5, borderWidth: 1, gap: 12, padding: 20 },
  stateText: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorText: { color: colors.red, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  secondaryButton: { borderColor: colors.green, borderRadius: 4, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 9 },
  secondaryButtonText: { color: colors.green, fontSize: 13, fontWeight: '700' },
  recipe: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 5, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  recipeImage: { backgroundColor: colors.greenLight, height: 164, width: '100%' },
  recipeBody: { padding: 16 },
  recipeTopline: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  recipeTitle: { color: colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 23 },
  glassware: { backgroundColor: colors.greenLight, borderRadius: 3, color: colors.green, fontSize: 11, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  recipeIngredients: { borderBottomColor: colors.line, borderBottomWidth: 1, borderTopColor: colors.line, borderTopWidth: 1, marginTop: 13, paddingVertical: 8 },
  recipeIngredient: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  ingredientAmount: { color: colors.green, fontSize: 12, fontWeight: '800', minWidth: 64 },
  ingredientName: { color: colors.ink, flex: 1, fontSize: 13 },
  instructions: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12 },
});
