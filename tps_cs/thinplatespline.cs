/******************************************************************************
 * thinplatespline.cs
 *
 * Project:  thinplatespline
 * Purpose:  Declarations for 2D Thin Plate Spline transformer. 
 * Author:   Ko Nagase, geosanak@gmail.com
 * 
 ******************************************************************************
 * Copyright (c) 2004, VIZRT Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 ****************************************************************************/
#undef VIZ_GEOREF_SPLINE_DEBUG

using System;
using System.Collections;

public enum vizGeorefInterType
{
    VIZ_GEOREF_SPLINE_ZERO_POINTS,
    VIZ_GEOREF_SPLINE_ONE_POINT,
    VIZ_GEOREF_SPLINE_TWO_POINTS,
    VIZ_GEOREF_SPLINE_ONE_DIMENSIONAL,
    VIZ_GEOREF_SPLINE_FULL,
	
    VIZ_GEOREF_SPLINE_POINT_WAS_ADDED,
    VIZ_GEOREF_SPLINE_POINT_WAS_DELETED

};

/////////////////////////////////////////////////////////////////////////////////////
//// vizGeorefSpline2D
/////////////////////////////////////////////////////////////////////////////////////


public class VizGeorefSpline2D
{
    //private const int VIZ_GEOREF_SPLINE_MAX_POINTS = 40;
    private const int VIZGEOREF_MAX_VARS = 2;

    public VizGeorefSpline2D(int nof_vars = 1){
        x = y = u = null;
        unused = index = null;
        for( int i = 0; i < nof_vars; i++ )
        {
            rhs[i] = null;
            coef[i] = null;
        }
          
        _tx = _ty = 0.0;		
        _ta = 10.0;
        _nof_points = 0;
        _nof_vars = nof_vars;
        _max_nof_points = 0;
        _AA = null;
        _Ainv = null;
        grow_points();
        type = vizGeorefInterType.VIZ_GEOREF_SPLINE_ZERO_POINTS;
    }

    /*
    ~VizGeorefSpline2D(){
        if ( _AA )
            free(_AA);
        if ( _Ainv )
            free(_Ainv);

        free( x );
        free( y );
        free( u );
        free( unused );
        free( index );
        for( int i = 0; i < _nof_vars; i++ )
        {
            free( rhs[i] );
            free( coef[i] );
        }
    }
    */

    public int get_nof_points(){
        return _nof_points;
    }

    public void set_toler( double tx, double ty ){
        _tx = tx;
        _ty = ty;
    }

    public void get_toler( ref double tx, ref double ty) {
        tx = _tx;
        ty = _ty;
    }

    public vizGeorefInterType get_interpolation_type ( ){
        return type;
    }

    public void dump_data_points()
	{
            for ( int i = 0; i < _nof_points; i++ )
            {
                Console.Error.Write("X = {0} Y = {1} Vars = ", x[i], y[i]);
                for ( int v = 0; v < _nof_vars; v++ )
                    Console.Error.Write("{0} ", rhs[v][i+3]);
                Console.Error.Write("\n");
            }
	}
    public int delete_list()
	{
            _nof_points = 0;
            type = vizGeorefInterType.VIZ_GEOREF_SPLINE_ZERO_POINTS;
            if ( _AA != null )
            {
                _AA = null;
            }
            if ( _Ainv != null )
            {
                _Ainv = null;
            }
            return _nof_points;
	}

    public void grow_points()
    {
        int new_max = _max_nof_points*2 + 2 + 3;
        int i;

        if( _max_nof_points == 0 )
        {
            x = new double[new_max];
            y = new double[new_max];
            u = new double[new_max];
            unused = new int[new_max];
            index = new int[new_max];
            for( i = 0; i < VIZGEOREF_MAX_VARS; i++ )
            {
                rhs[i] = new double[new_max];
                coef[i] = new double[new_max];
            }
        }
        else
        {
            Array.Resize<double>( ref x, new_max );
            Array.Resize<double>( ref y, new_max );
            Array.Resize<double>( ref u, new_max );
            Array.Resize<int>( ref unused, new_max );
            Array.Resize<int>( ref index, new_max );
            for( i = 0; i < VIZGEOREF_MAX_VARS; i++ )
            {
                Array.Resize<double>( ref rhs[i], new_max );
                Array.Resize<double>( ref coef[i], new_max );
            }
        }

        _max_nof_points = new_max - 3;
    }

    public int add_point( double Px, double Py, double[] Pvars )
    {
        type = vizGeorefInterType.VIZ_GEOREF_SPLINE_POINT_WAS_ADDED;
        int i;

        if( _nof_points == _max_nof_points )
            grow_points();

        i = _nof_points;
        //A new point is added
        x[i] = Px;
        y[i] = Py;
        for ( int j = 0; j < _nof_vars; j++ )
            rhs[j][i+3] = Pvars[j];
        _nof_points++;
        return 1;
    }

    public int delete_point(double Px, double Py )
    {
        for ( int i = 0; i < _nof_points; i++ )
        {
            if ( ( Math.Abs(Px - x[i]) <= _tx) && ( Math.Abs(Py - y[i]) <= _ty ) )
            {
                for ( int j = i; j < _nof_points - 1; j++ )
                {
                    x[j] = x[j+1];
                    y[j] = y[j+1];
                    for ( int k = 0; k < _nof_vars; k++ )
                        rhs[k][j+3] = rhs[k][j+3+1];
                }
                _nof_points--;
                type = vizGeorefInterType.VIZ_GEOREF_SPLINE_POINT_WAS_DELETED;
                return (1);
            }
        }
        return (0);
    }

    public int get_point( double Px, double Py, double[] vars )
    {
        int v, r;
        double tmp, Pu;
        double fact;
        int leftP=0, rightP=0, found = 0;

        switch ( type )
        {
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_ZERO_POINTS:
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = 0.0;
            break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_ONE_POINT:
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = rhs[v][3];
            break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_TWO_POINTS:
            fact = _dx * ( Px - x[0] ) + _dy * ( Py - y[0] );
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = ( 1 - fact ) * rhs[v][3] + fact * rhs[v][4];
            break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_ONE_DIMENSIONAL:
            Pu = _dx * ( Px - x[0] ) + _dy * ( Py - y[0] );
            if ( Pu <= u[index[0]] )
            {
                leftP = index[0];
                rightP = index[1];
            }
            else if ( Pu >= u[index[_nof_points-1]] )
            {
                leftP = index[_nof_points-2];
                rightP = index[_nof_points-1];
            }
            else
            {
                for ( r = 1; found == 0 && r < _nof_points; r++ )
                {
                    leftP = index[r-1];
                    rightP = index[r];
                    if ( Pu >= u[leftP] && Pu <= u[rightP] )
                        found = 1;
                }
            }

            fact = ( Pu - u[leftP] ) / ( u[rightP] - u[leftP] );
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = ( 1.0 - fact ) * rhs[v][leftP+3] +
                fact * rhs[v][rightP+3];
            break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_FULL:
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = coef[v][0] + coef[v][1] * Px + coef[v][2] * Py;

            for ( r = 0; r < _nof_points; r++ )
            {
                tmp = base_func( Px, Py, x[r], y[r] );
                for ( v = 0; v < _nof_vars; v++ )
                    vars[v] += coef[v][r+3] * tmp;
            }
            break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_POINT_WAS_ADDED:
            Console.Error.Write(" A point was added after the last solve\n");
            Console.Error.Write(" NO interpolation - return values are zero\n");
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = 0.0;
            return (0);
            //break;
        case vizGeorefInterType.VIZ_GEOREF_SPLINE_POINT_WAS_DELETED:
            Console.Error.Write(" A point was deleted after the last solve\n");
            Console.Error.Write(" NO interpolation - return values are zero\n");
            for ( v = 0; v < _nof_vars; v++ )
                vars[v] = 0.0;
            return (0);
            //break;
        default:
            return (0);
            //break;
        }
        return(1);
    }

    public bool get_xy(int index, ref double outX, ref double outY)
    {
        bool ok;

        if ( index < _nof_points )
        {
            ok = true;
            outX = x[index];
            outY = y[index];
        }
        else
        {
            ok = false;
            outX = outY = 0.0f;
        }

        return(ok);
    }

    public bool change_point(int index, double Px, double Py, double[] Pvars)
    {
        if ( index < _nof_points )
        {
            int i = index;
            x[i] = Px;
            y[i] = Py;
            for ( int j = 0; j < _nof_vars; j++ )
                rhs[j][i+3] = Pvars[j];
        }

        return( true );
    }

    public void reset() { _nof_points = 0; }
    public int solve()
    {
        int r, c, v;
        int p;

        //	No points at all
        if ( _nof_points < 1 )
        {
            type = vizGeorefInterType.VIZ_GEOREF_SPLINE_ZERO_POINTS;
            return(0);
        }

        // Only one point
        if ( _nof_points == 1 )
        {
            type = vizGeorefInterType.VIZ_GEOREF_SPLINE_ONE_POINT;
            return(1);
        }
        // Just 2 points - it is necessarily 1D case
        if ( _nof_points == 2 )
        {
            _dx = x[1] - x[0];
            _dy = y[1] - y[0];
            double fact = 1.0 / ( _dx * _dx + _dy * _dy );
            _dx *= fact;
            _dy *= fact;

            type = vizGeorefInterType.VIZ_GEOREF_SPLINE_TWO_POINTS;
            return(2);
        }

        // More than 2 points - first we have to check if it is 1D or 2D case

        double xmax = x[0], xmin = x[0], ymax = y[0], ymin = y[0];
        double delx, dely;
        double xx, yy;
        double sumx = 0.0f, sumy = 0.0f, sumx2 = 0.0f, sumy2 = 0.0f, sumxy = 0.0f;
        double SSxx, SSyy, SSxy;

        for ( p = 0; p < _nof_points; p++ )
        {
            xx = x[p];
            yy = y[p];

            xmax = Math.Max( xmax, xx );
            xmin = Math.Min( xmin, xx );
            ymax = Math.Max( ymax, yy );
            ymin = Math.Min( ymin, yy );

            sumx  += xx;
            sumx2 += xx * xx;
            sumy  += yy;
            sumy2 += yy * yy;
            sumxy += xx * yy;
        }
        delx = xmax - xmin;
        dely = ymax - ymin;

        SSxx = sumx2 - sumx * sumx / _nof_points;
        SSyy = sumy2 - sumy * sumy / _nof_points;
        SSxy = sumxy - sumx * sumy / _nof_points;

        if ( delx < 0.001 * dely || dely < 0.001 * delx ||
             Math.Abs ( SSxy * SSxy / ( SSxx * SSyy ) ) > 0.99 )
        {
            int p1;

            type = vizGeorefInterType.VIZ_GEOREF_SPLINE_ONE_DIMENSIONAL;

            _dx = _nof_points * sumx2 - sumx * sumx;
            _dy = _nof_points * sumy2 - sumy * sumy;
            double fact = 1.0 / Math.Sqrt( _dx * _dx + _dy * _dy );
            _dx *= fact;
            _dy *= fact;

            for ( p = 0; p < _nof_points; p++ )
            {
                double dxp = x[p] - x[0];
                double dyp = y[p] - y[0];
                u[p] = _dx * dxp + _dy * dyp;
                unused[p] = 1;
            }

            for ( p = 0; p < _nof_points; p++ )
            {
                int min_index = -1;
                double min_u = 0;
                for ( p1 = 0; p1 < _nof_points; p1++ )
                {
                    if ( unused[p1] != 0 )
                    {
                        if ( min_index < 0 || u[p1] < min_u )
                        {
                            min_index = p1;
                            min_u = u[p1];
                        }
                    }
                }
                index[p] = min_index;
                unused[min_index] = 0;
            }

            return(3);
        }

        type = vizGeorefInterType.VIZ_GEOREF_SPLINE_FULL;
        // Make the necessary memory allocations
        if ( _AA != null )
            _AA = null;
        if ( _Ainv != null )
            _Ainv = null;

        _nof_eqs = _nof_points + 3;

        _AA = new double[_nof_eqs * _nof_eqs];
        _Ainv = new double[_nof_eqs * _nof_eqs];

        // Calc the values of the matrix A
        for ( r = 0; r < 3; r++ )
            for ( c = 0; c < 3; c++ )
                _AA[_nof_eqs * (r) + (c)] = 0.0;

        for ( c = 0; c < _nof_points; c++ )
        {
            _AA[_nof_eqs * (0) + (c+3)] = 1.0;
            _AA[_nof_eqs * (1) + (c+3)] = x[c];
            _AA[_nof_eqs * (2) + (c+3)] = y[c];

            _AA[_nof_eqs * (c+3) + (0)] = 1.0;
            _AA[_nof_eqs * (c+3) + (1)] = x[c];
            _AA[_nof_eqs * (c+3) + (2)] = y[c];
        }

        for ( r = 0; r < _nof_points; r++ )
            for ( c = r; c < _nof_points; c++ )
            {
                _AA[_nof_eqs * (r+3) + (c+3)] = base_func( x[r], y[r], x[c], y[c] );
                if ( r != c )
                    _AA[_nof_eqs * (c+3) + (r+3) ] = _AA[_nof_eqs * (r+3) + (c+3)];
            }

#if VIZ_GEOREF_SPLINE_DEBUG

        for ( r = 0; r < _nof_eqs; r++ )
        {
            for ( c = 0; c < _nof_eqs; c++ )
                Console.Error.Write("%f", _AA[_nof_eqs * (r) + (c)]);
            Console.Error.Write("\n");
        }

#endif

        // Invert the matrix
        bool status = matrixInvert( _nof_eqs, _AA, _Ainv );

        if ( !status )
        {
            // fprintf(stderr, " There is a problem to invert the interpolation matrix\n");
            return 0;
        }

        // calc the coefs
        for ( v = 0; v < _nof_vars; v++ )
            for ( r = 0; r < _nof_eqs; r++ )
            {
                coef[v][r] = 0.0;
                for ( c = 0; c < _nof_eqs; c++ )
                    coef[v][r] += _Ainv[_nof_eqs * (r) + (c)] * rhs[v][c];
            }

        return(4);
    }

    private double base_func( double x1, double y1,
                      double x2, double y2 )
    {
        if ( ( x1 == x2 ) && ( y1 == y2 ) )
            return 0.0;

        double dist = ( x2 - x1 ) * ( x2 - x1 ) + ( y2 - y1 ) * ( y2 - y1 );

        return dist * Math.Log( dist );
    }

    private bool matrixInvert( int N, double[] input, double[] output )
    {
        // Receives an array of dimension NxN as input.  This is passed as a one-
        // dimensional array of N-squared size.  It produces the inverse of the
        // input matrix, returned as output, also of size N-squared.  The Gauss-
        // Jordan Elimination method is used.  (Adapted from a BASIC routine in
        // "Basic Scientific Subroutines Vol. 1", courtesy of Scott Edwards.)

        // Array elements 0...N-1 are for the first row, N...2N-1 are for the
        // second row, etc.

        // We need to have a temporary array of size N x 2N.  We'll refer to the
        // "left" and "right" halves of this array.

        int row, col;

#if false
        Console.Error.Write("Matrix Inversion input matrix (N={0})\n", N);
        for ( row=0; row<N; row++ )
        {
            for ( col=0; col<N; col++ )
            {
                // TODO:C# format
                Console.Error.Write("%5.2f ", input[row*N + col ]  );
            }
            Console.Error.Write("\n");
        }
#endif

        int tempSize = 2 * N * N;
        double[] temp = new double[ tempSize ];
        double ftemp;

        if (temp == null) {

            Console.Error.Write("matrixInvert(): ERROR - memory allocation failed.\n");
            return false;
        }

        // First create a double-width matrix with the input array on the left
        // and the identity matrix on the right.

        for ( row=0; row<N; row++ )
        {
            for ( col=0; col<N; col++ )
            {
                // Our index into the temp array is X2 because it's twice as wide
                // as the input matrix.

                temp[ 2*row*N + col ] = input[ row*N+col ];	// left = input matrix
                temp[ 2*row*N + col + N ] = 0.0f;			// right = 0
            }
            temp[ 2*row*N + row + N ] = 1.0f;		// 1 on the diagonal of RHS
        }

        // Now perform row-oriented operations to convert the left hand side
        // of temp to the identity matrix.  The inverse of input will then be
        // on the right.

        int max;
        int k=0;
        for (k = 0; k < N; k++)
        {
            if (k+1 < N)	// if not on the last row
            {
                max = k;
                for (row = k+1; row < N; row++) // find the maximum element
                {
                    if (Math.Abs( temp[row*2*N + k] ) > Math.Abs( temp[max*2*N + k] ))
                    {
                        max = row;
                    }
                }

                if (max != k)	// swap all the elements in the two rows
                {
                    for (col=k; col<2*N; col++)
                    {
                        ftemp = temp[k*2*N + col];
                        temp[k*2*N + col] = temp[max*2*N + col];
                        temp[max*2*N + col] = ftemp;
                    }
                }
            }

            ftemp = temp[ k*2*N + k ];
            if ( ftemp == 0.0f ) // matrix cannot be inverted
            {
                temp = null;
                return false;
            }

            for ( col=k; col<2*N; col++ )
            {
                temp[ k*2*N + col ] /= ftemp;
            }

            for ( row=0; row<N; row++ )
            {
                if ( row != k )
                {
                    ftemp = temp[ row*2*N + k ];
                    for ( col=k; col<2*N; col++ )
                    {
                        temp[ row*2*N + col ] -= ftemp * temp[ k*2*N + col ];
                    }
                }
            }
        }

        // Retrieve inverse from the right side of temp

        for (row = 0; row < N; row++)
        {
            for (col = 0; col < N; col++)
            {
                output[row*N + col] = temp[row*2*N + col + N ];
            }
        }

#if false
        Console.Error.Write("Matrix Inversion result matrix:\n");
        for ( row=0; row<N; row++ )
        {
            for ( col=0; col<N; col++ )
            {
                // TODO:C# format
                Console.Error.Write("%5.2f ", output[row*N + col ]  );
            }
            Console.Error.Write("\n");
        }
#endif

        temp = null;       // free memory
        return true;
    }

    private vizGeorefInterType type;

    private int _nof_vars;
    private int _nof_points;
    private int _max_nof_points;
    private int _nof_eqs;

    private double _tx, _ty;
    private double _ta;
    private double _dx, _dy;

    private double[] x; // [VIZ_GEOREF_SPLINE_MAX_POINTS+3];
    private double[] y; // [VIZ_GEOREF_SPLINE_MAX_POINTS+3];

//    double rhs[VIZ_GEOREF_SPLINE_MAX_POINTS+3][VIZGEOREF_MAX_VARS];
//    double coef[VIZ_GEOREF_SPLINE_MAX_POINTS+3][VIZGEOREF_MAX_VARS];
    private double[][] rhs = new double[VIZGEOREF_MAX_VARS][];
    private double[][] coef = new double[VIZGEOREF_MAX_VARS][];

    private double[] u; // [VIZ_GEOREF_SPLINE_MAX_POINTS];
    private int[] unused; // [VIZ_GEOREF_SPLINE_MAX_POINTS];
    private int[] index; // [VIZ_GEOREF_SPLINE_MAX_POINTS];
	
    private double[] _AA, _Ainv;
};


