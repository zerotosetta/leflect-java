package io.lefectjava.worker.parser;

import com.github.javaparser.resolution.TypeSolver;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;

/** Shares the exact analysis environment with call-site generic inference. */
public final class AnalysisSymbolResolver extends JavaSymbolSolver {
  private final TypeSolver typeSolver;

  public AnalysisSymbolResolver(TypeSolver typeSolver) {
    super(typeSolver);
    this.typeSolver = typeSolver;
  }

  public TypeSolver getTypeSolver() { return typeSolver; }
}
