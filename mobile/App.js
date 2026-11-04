import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://bartender-aid.onrender.com/api').replace(/\/+$/, '');

const colors = {
  ink: '#F9FAFB',
  muted: '#9CA3AF',
  paper: '#0B0F19',
  white: '#111827',
  line: '#1F2937',
  green: '#10B981',
  greenLight: 'rgba(16, 185, 129, 0.15)',
  citrus: '#F59E0B',
  citrusLight: 'rgba(245, 158, 11, 0.15)',
  red: '#F87171',
};

export default function App() {
  const [ingredients, setIngredients] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [cocktails, setCocktails] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCocktail, setSelectedCocktail] = useState(null);
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

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredIngredients = ingredients.filter((ingredient) => (
    ingredient.name.toLowerCase().includes(normalizedSearch)
    || (ingredient.category || '').toLowerCase().includes(normalizedSearch)
  ));

  const groupedIngredients = filteredIngredients.reduce((groups, ingredient) => {
    const category = ingredient.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(ingredient);
    return groups;
  }, {});

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>BARTENDER AID</Text>
          <View style={styles.selectedCount}>
            <Text style={styles.selectedCountText}>{selectedIds.length} SELECTED</Text>
          </View>
        </View>

        <Text style={styles.title}>What's in your bar?</Text>
        <Text style={styles.subtitle}>Select your bar stock to discover what you can pour.</Text>

        <View style={styles.inventoryHeader}>
          <Text style={styles.sectionTitle}>1. What's in your bar?</Text>
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
          <>
            <TextInput
              accessibilityLabel="Search ingredients"
              style={styles.searchInput}
              placeholder="Search ingredients or categories"
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {Object.keys(groupedIngredients).length === 0 ? (
              <Text style={styles.noResultsText}>No ingredients match that search.</Text>
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
                            {isSelected ? '\u2713 ' : ''}{ingredient.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </>
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
            <Text style={styles.findButtonText}>Find Matching Cocktails ({selectedIds.length})</Text>
          )}
        </Pressable>

        <View style={styles.resultsHeader}>
          <Text style={styles.sectionTitle}>2. Cocktail Menu</Text>
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
            <Text style={styles.stateText}>Tap your ingredients above and search to discover drinks.</Text>
          </View>
        ) : (
          cocktails.map((cocktail) => {
            const isReady = cocktail.matched_count === cocktail.total_required;
            const missingCount = Math.max(0, cocktail.total_required - cocktail.matched_count);
            return (
            <Pressable
              key={cocktail.id}
              accessibilityRole="button"
              accessibilityLabel={`View ${cocktail.name} recipe`}
              onPress={() => setSelectedCocktail(cocktail)}
              style={[styles.recipe, isReady && styles.recipeReady]}
            >
              {cocktail.image_url ? (
                <Image source={{ uri: cocktail.image_url }} style={styles.recipeImage} />
              ) : null}
              <View style={styles.recipeBody}>
                <View style={styles.recipeTopline}>
                  <Text style={styles.recipeTitle}>{cocktail.name}</Text>
                  <View style={[styles.badge, isReady ? styles.badgeReady : styles.badgeMissing]}>
                    <Text style={[styles.badgeText, isReady ? styles.badgeTextReady : styles.badgeTextMissing]}>
                      {isReady ? 'Ready' : `Missing ${missingCount}`}
                    </Text>
                  </View>
                </View>
                {cocktail.glassware ? <Text style={styles.glassware}>{cocktail.glassware}</Text> : null}
                <Text style={styles.instructions}>{cocktail.instructions}</Text>
              </View>
            </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent
        visible={Boolean(selectedCocktail)}
        onRequestClose={() => setSelectedCocktail(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedCocktail?.image_url ? (
              <Image source={{ uri: selectedCocktail.image_url }} style={styles.modalImage} />
            ) : null}
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{selectedCocktail?.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close recipe"
                onPress={() => setSelectedCocktail(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>X</Text>
              </Pressable>
            </View>
            {selectedCocktail?.glassware ? (
              <Text style={styles.glassware}>Glassware: {selectedCocktail.glassware}</Text>
            ) : null}
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalSubheading}>Ingredients required</Text>
              {(selectedCocktail?.recipe_ingredients || []).map((ingredient) => (
                <View key={ingredient.id} style={styles.modalIngredientRow}>
                  <Text style={[styles.modalIngredientName, !ingredient.hasIt && styles.missingIngredient]}>
                    {ingredient.hasIt ? 'Have' : 'Missing'}: {ingredient.name}
                  </Text>
                  <Text style={styles.modalIngredientAmount}>{ingredient.amount || 'Amount not listed'}</Text>
                </View>
              ))}
              <Text style={styles.modalSubheading}>Instructions</Text>
              <Text style={styles.modalInstructions}>{selectedCocktail?.instructions}</Text>
              {selectedCocktail?.source_url ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => Linking.openURL(selectedCocktail.source_url).catch(() => {})}
                >
                  <Text style={styles.sourceAttribution}>Recipe data: TheCocktailDB</Text>
                </Pressable>
              ) : null}
            </ScrollView>
            <Pressable style={styles.modalDoneButton} onPress={() => setSelectedCocktail(null)}>
              <Text style={styles.modalDoneButtonText}>Close recipe</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  screen: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 44 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.green, fontSize: 12, fontWeight: '800' },
  selectedCount: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.white, borderRadius: 8 },
  selectedCountText: { color: colors.green, fontSize: 10, fontWeight: '800' },
  title: { color: colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 34, lineHeight: 40, marginTop: 22 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 340 },
  inventoryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 30, marginBottom: 14 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  itemCount: { color: colors.muted, fontSize: 12 },
  searchInput: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, fontSize: 14, marginBottom: 16, minHeight: 46, paddingHorizontal: 14 },
  noResultsText: { color: colors.muted, fontSize: 14, paddingVertical: 18, textAlign: 'center' },
  categoryBlock: { marginBottom: 17 },
  categoryLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 9, textTransform: 'uppercase' },
  chipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 4, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 8 },
  chipSelected: { backgroundColor: colors.citrus, borderColor: colors.citrus },
  chipText: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  chipTextSelected: { color: '#111827', fontWeight: '700' },
  findButton: { alignItems: 'center', backgroundColor: colors.citrus, borderRadius: 12, justifyContent: 'center', marginTop: 16, minHeight: 54, paddingHorizontal: 12 },
  findButtonDisabled: { backgroundColor: '#374151' },
  findButtonText: { color: '#111827', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  buttonPressed: { opacity: 0.8 },
  resultsHeader: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13, marginTop: 30 },
  statePanel: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 5, borderWidth: 1, gap: 12, padding: 20 },
  stateText: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorText: { color: colors.red, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  secondaryButton: { borderColor: colors.citrus, borderRadius: 8, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 9 },
  secondaryButtonText: { color: colors.citrus, fontSize: 13, fontWeight: '700' },
  recipe: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 14, borderWidth: 1, marginBottom: 14, overflow: 'hidden' },
  recipeReady: { borderColor: colors.green, borderWidth: 1.5 },
  recipeImage: { backgroundColor: colors.greenLight, height: 164, width: '100%' },
  recipeBody: { padding: 16 },
  recipeTopline: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  recipeTitle: { color: colors.ink, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 23, flexShrink: 1 },
  glassware: { color: colors.citrus, fontSize: 11, fontWeight: '700', marginTop: 8, textTransform: 'uppercase' },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeReady: { backgroundColor: colors.greenLight },
  badgeMissing: { backgroundColor: colors.citrusLight },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextReady: { color: '#34D399' },
  badgeTextMissing: { color: '#FBBF24' },
  recipeIngredients: { borderBottomColor: colors.line, borderBottomWidth: 1, borderTopColor: colors.line, borderTopWidth: 1, marginTop: 13, paddingVertical: 8 },
  recipeIngredient: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  ingredientAmount: { color: colors.citrus, fontSize: 12, fontWeight: '800', minWidth: 64 },
  ingredientName: { color: colors.ink, flex: 1, fontSize: 13 },
  instructions: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12 },
  sourceAttribution: { color: colors.citrus, fontSize: 12, marginTop: 10, textDecorationLine: 'underline' },
  modalOverlay: { backgroundColor: 'rgba(0, 0, 0, 0.78)', flex: 1, justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.white, borderColor: colors.line, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, maxHeight: '88%', padding: 20 },
  modalImage: { borderRadius: 8, height: 180, marginBottom: 14, width: '100%' },
  modalHeaderRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  modalTitle: { color: colors.ink, flex: 1, fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 26 },
  closeButton: { alignItems: 'center', backgroundColor: colors.line, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  closeButtonText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  modalScroll: { marginTop: 8 },
  modalSubheading: { color: colors.ink, fontSize: 15, fontWeight: '800', marginBottom: 8, marginTop: 14 },
  modalIngredientRow: { borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingVertical: 9 },
  modalIngredientName: { color: colors.ink, flex: 1, fontSize: 14 },
  missingIngredient: { color: '#FBBF24' },
  modalIngredientAmount: { color: colors.citrus, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  modalInstructions: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 10 },
  modalDoneButton: { alignItems: 'center', backgroundColor: colors.citrus, borderRadius: 8, justifyContent: 'center', marginTop: 12, minHeight: 48 },
  modalDoneButtonText: { color: '#111827', fontSize: 15, fontWeight: '800' },
});
