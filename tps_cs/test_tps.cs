/******************************************************************************
 * test_tps.cs
 *
 * Project:  thinplatespline
 * Purpose:  Simple test example of 2D Thin Plate Spline transformer.
 * Author:   Ko Nagase, geosanak@gmail.com
 *
 ******************************************************************************
 * Copyright (c) 2011, Omniscale GmbH & Co. KG
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

using System;

class Program
{
    static void Main(string[] args)
    {
        // test_init_from_list
        {
            double[][] points = 
            {
                new double[] {0, 0, 50, 50},
                new double[] {10, 10, 100, 100}
            };
            TPS t = new TPS(points);
            double[] dst = new double[2];
            t.transform(4, 5, dst);
            if (!(dst[0] == 72.5 && dst[1] == 72.5))
            {
                // TODO:
                Console.Out.Write("test_init_from_list-1: failed\n");
            }
            t.add(0, 10, 70, 100);
            t.transform(4, 5, dst);
            if (!(dst[0] == 72.0 && dst[1] == 75.0))
            {
                // TODO:
                Console.Out.Write("test_init_from_list-2:failed\n");
            }
        }
        // test_simple
        {
            TPS t = new TPS();
            t.add(0, 0, 50, 50);
            t.add(10, 10, 100, 100);
            double[] dst = new double[2];
            t.transform(4, 5, dst);
            if (!(dst[0] == 72.5 && dst[1] == 72.5))
            {
                // TODO:
                Console.Out.Write("test_simple-1:failed\n");
            }
            t.add(0, 10, 70, 100);
            t.transform(4, 5, dst);
            if (!(dst[0] == 72.0 && dst[1] == 75.0))
            {
                // TODO:
                Console.Out.Write("test_simple-2:failed\n");
            }
        }
        // test_no_points
        {
            try
            {
                TPS t = new TPS();
                double[] dst = new double[2];
                t.transform(0, 0, dst);
                Console.Out.Write("test_no_points-1:failed\n");
            }
            catch (Exception ex)
            {
            }
        }
        // test_from_control_points_list
        {
            double[][] points = 
            {
                new double[] {0, 0, 50, 50},
                new double[] {10, 10, 100, 100},
                new double[] {0, 10, 70, 100}
            };
            TPS t = TPS.from_control_points(points);
            double[] dst = new double[2];
            t.transform(4, 5, dst);
            if (!(dst[0] == 72.0 && dst[1] == 75.0))
            {
                // TODO:
                Console.Out.Write("test_from_control_points_list-1:failed\n");
            }
        }
        // test_from_control_points_list_backwards
        { 
            double[][] points = 
            {
                new double[] {0, 0, 50, 50},
                new double[] {10, 10, 100, 100},
                new double[] {0, 10, 70, 100}
            };
            TPS t = TPS.from_control_points(points, true);
            double[] dst = new double[2];
            t.transform(72, 75, dst);
            if (!(dst[0] == 4.0 && dst[1] == 5.0))
            {
                // TODO:
                Console.Out.Write("test_from_control_points_list_backwards-1:failed\n");
            }
        }
        return;
    }
}
